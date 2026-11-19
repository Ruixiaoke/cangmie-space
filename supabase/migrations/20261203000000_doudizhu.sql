-- 斗地主（群聊里的三人小游戏）：牌桌、手牌、完整状态、群内累计积分、大厅 RPC、成员离开时的座位处理
-- 由 GitHub Actions 自动执行；可重复运行（整套迁移会跑两遍）
--
-- 设计：服务器（Edge Function ddz）是唯一的裁判，手牌是秘密：
--   ddz_state  整局的完整状态（含三家手牌）。不给 authenticated / anon 任何权限，只有 Edge Function（service role）读写
--   ddz_hands  每个真人座位的自己手牌，RLS 只允许本人读：真人通过 select + Realtime 拿到自己的牌，旁观者什么也看不到
--   ddz_games  牌桌：座位、机器人、托管、公开视图 pub（别人的手牌只有张数）、本轮出牌截止时间 deadline、version（乐观并发）
--   ddz_scores 每个群里每个人的累计积分
-- 大厅操作（开桌 / 入座 / 离座 / 加减机器人）在 SQL 里；叫分、出牌、开始、超时托管在 Edge Function 里，
-- 它们通过 ddz_commit 一次性（原子地）写 ddz_games / ddz_state / ddz_hands / ddz_scores / 系统消息。

-- ============================================================
-- 表
-- ============================================================

create table if not exists public.ddz_games (
  id          bigint generated always as identity primary key,
  group_id    bigint      not null references public.groups (id) on delete cascade,
  created_by  uuid        references public.profiles (id) on delete set null,
  message_id  bigint      references public.messages (id) on delete set null,
  status      text        not null default 'waiting'
              constraint ddz_games_status_valid check (status in ('waiting', 'bidding', 'playing', 'over', 'closed')),
  seats       uuid[]      not null default array[null, null, null]::uuid[]
              constraint ddz_games_seats_len check (cardinality(seats) = 3),
  bots        boolean[]   not null default array[false, false, false]
              constraint ddz_games_bots_len check (cardinality(bots) = 3),
  auto        boolean[]   not null default array[false, false, false]
              constraint ddz_games_auto_len check (cardinality(auto) = 3),
  round       integer     not null default 0,
  pub         jsonb       not null default '{}'::jsonb,
  deadline    timestamptz,
  version     integer     not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists ddz_games_group_idx on public.ddz_games (group_id, id desc);
-- 每个群同时只有一张没结束的桌子
create unique index if not exists ddz_games_one_open
  on public.ddz_games (group_id) where status in ('waiting', 'bidding', 'playing');

create table if not exists public.ddz_hands (
  game_id  bigint   not null references public.ddz_games (id) on delete cascade,
  seat     smallint not null check (seat between 0 and 2),
  user_id  uuid     not null references public.profiles (id) on delete cascade,
  round    integer  not null default 0,
  cards    smallint[] not null default '{}',
  primary key (game_id, seat)
);
create index if not exists ddz_hands_user_idx on public.ddz_hands (user_id);

create table if not exists public.ddz_state (
  game_id     bigint primary key references public.ddz_games (id) on delete cascade,
  state       jsonb  not null,
  updated_at  timestamptz not null default now()
);

create table if not exists public.ddz_scores (
  group_id  bigint  not null references public.groups (id) on delete cascade,
  user_id   uuid    not null references public.profiles (id) on delete cascade,
  total     integer not null default 0,
  games     integer not null default 0,
  wins      integer not null default 0,
  primary key (group_id, user_id)
);

-- ============================================================
-- 权限
-- ============================================================

revoke all on table public.ddz_games, public.ddz_hands, public.ddz_state, public.ddz_scores from public, anon, authenticated;
grant select on table public.ddz_games, public.ddz_hands, public.ddz_scores to authenticated;
alter table public.ddz_games  enable row level security;
alter table public.ddz_hands  enable row level security;
alter table public.ddz_state  enable row level security; -- 没有任何策略：只有 service role 能碰
alter table public.ddz_scores enable row level security;

drop policy if exists ddz_games_select_member on public.ddz_games;
create policy ddz_games_select_member on public.ddz_games
  for select to authenticated
  using (group_id in (select public.my_group_ids()));

drop policy if exists ddz_hands_select_own on public.ddz_hands;
create policy ddz_hands_select_own on public.ddz_hands
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists ddz_scores_select_member on public.ddz_scores;
create policy ddz_scores_select_member on public.ddz_scores
  for select to authenticated
  using (group_id in (select public.my_group_ids()));

-- Edge Function 用的后端角色：云端不一定默认给新表权限，本地裸 Postgres 可能没有这个角色
do $$
declare
  v_role text := 'service' || '_role';
begin
  if exists (select 1 from pg_roles where rolname = v_role) then
    execute format('grant select, insert, update, delete on table public.ddz_games, public.ddz_hands, public.ddz_state, public.ddz_scores to %I', v_role);
    execute format('grant select on table public.groups, public.group_members, public.profiles to %I', v_role);
    execute format('grant insert on table public.messages to %I', v_role);
    execute format('grant select on table public.push_subscriptions to %I', v_role);
  end if;
end $$;

-- ============================================================
-- 大厅 RPC
-- ============================================================

-- 开桌（每个群一张）：已经有没结束的桌子就直接返回它；否则建桌、开桌的人坐 0 号位，并以他的身份在群里发 [斗地主]#id 卡片
-- 超过 6 小时没有任何动静的旧桌子视为被丢下了，先关掉
create or replace function public.ddz_open(p_group bigint)
returns public.ddz_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me  uuid := auth.uid();
  v_g   public.ddz_games;
  v_msg bigint;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  perform 1 from public.groups gr where gr.id = p_group for update; -- 同一个群的开桌排队
  if not found or not exists (select 1 from public.group_members gm where gm.group_id = p_group and gm.user_id = v_me) then
    raise exception 'not_group_member';
  end if;

  update public.ddz_games x
     set status = 'closed', deadline = null, version = x.version + 1, updated_at = now()
   where x.group_id = p_group and x.status in ('waiting', 'bidding', 'playing') and x.updated_at < now() - interval '6 hours';

  select * into v_g from public.ddz_games x
   where x.group_id = p_group and x.status in ('waiting', 'bidding', 'playing');
  if found then
    return v_g;
  end if;

  insert into public.ddz_games (group_id, created_by, seats)
  values (p_group, v_me, array[v_me, null, null]::uuid[])
  returning * into v_g;

  insert into public.messages (sender_id, group_id, body)
  values (v_me, p_group, '[斗地主]#' || v_g.id)
  returning id into v_msg;
  update public.ddz_games x set message_id = v_msg where x.id = v_g.id returning * into v_g;
  update public.group_members gm set last_read_id = greatest(gm.last_read_id, v_msg)
   where gm.group_id = p_group and gm.user_id = v_me;
  update public.groups gr set updated_at = now() where gr.id = p_group;
  return v_g;
end;
$$;

-- 取一张等人的桌子并加锁；检查调用者是群成员。p_must_sit：调用者必须已经坐在桌上
create or replace function public.ddz_lock_waiting(p_game bigint, p_must_sit boolean)
returns public.ddz_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_g  public.ddz_games;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into v_g from public.ddz_games x where x.id = p_game for update;
  if not found then
    raise exception 'table_not_found';
  end if;
  if not exists (select 1 from public.group_members gm where gm.group_id = v_g.group_id and gm.user_id = v_me) then
    raise exception 'not_group_member';
  end if;
  if v_g.status <> 'waiting' then
    raise exception 'table_not_waiting';
  end if;
  if p_must_sit and array_position(v_g.seats, v_me) is null then
    raise exception 'not_seated';
  end if;
  return v_g;
end;
$$;
revoke execute on function public.ddz_lock_waiting(bigint, boolean) from public, anon, authenticated;

-- 入座：座位必须是空的（没有真人也没有机器人）；我已经坐在别的座位就换过去
create or replace function public.ddz_sit(p_game bigint, p_seat integer)
returns public.ddz_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_g     public.ddz_games;
  v_seats uuid[];
  i       integer;
begin
  v_g := public.ddz_lock_waiting(p_game, false);
  if p_seat is null or p_seat not between 0 and 2 then
    raise exception 'invalid_seat';
  end if;
  if v_g.seats[p_seat + 1] is not null or v_g.bots[p_seat + 1] then
    if v_g.seats[p_seat + 1] = v_me then
      return v_g; -- 本来就坐在这里
    end if;
    raise exception 'seat_taken';
  end if;
  v_seats := v_g.seats;
  for i in 1..3 loop
    if v_seats[i] = v_me then v_seats[i] := null; end if;
  end loop;
  v_seats[p_seat + 1] := v_me;
  update public.ddz_games x set seats = v_seats, version = x.version + 1, updated_at = now()
   where x.id = p_game returning * into v_g;
  return v_g;
end;
$$;

-- 离座（只能在等人的时候）；最后一个真人离开时整张桌子关掉
create or replace function public.ddz_stand(p_game bigint)
returns public.ddz_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_g     public.ddz_games;
  v_seats uuid[];
  i       integer;
  v_left  integer := 0;
begin
  v_g := public.ddz_lock_waiting(p_game, true);
  v_seats := v_g.seats;
  for i in 1..3 loop
    if v_seats[i] = v_me then v_seats[i] := null; end if;
    if v_seats[i] is not null then v_left := v_left + 1; end if;
  end loop;
  update public.ddz_games x
     set seats = v_seats,
         status = case when v_left = 0 then 'closed' else x.status end,
         version = x.version + 1, updated_at = now()
   where x.id = p_game returning * into v_g;
  return v_g;
end;
$$;

-- 加 / 移除机器人：任何坐在桌上的人；只能加在空座位上，只能移除机器人
create or replace function public.ddz_set_bot(p_game bigint, p_seat integer, p_on boolean)
returns public.ddz_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g    public.ddz_games;
  v_bots boolean[];
begin
  v_g := public.ddz_lock_waiting(p_game, true);
  if p_seat is null or p_seat not between 0 and 2 or p_on is null then
    raise exception 'invalid_seat';
  end if;
  v_bots := v_g.bots;
  if p_on then
    if v_g.seats[p_seat + 1] is not null or v_g.bots[p_seat + 1] then
      raise exception 'seat_taken';
    end if;
    v_bots[p_seat + 1] := true;
  else
    if not v_g.bots[p_seat + 1] then
      raise exception 'not_a_bot';
    end if;
    v_bots[p_seat + 1] := false;
  end if;
  update public.ddz_games x set bots = v_bots, version = x.version + 1, updated_at = now()
   where x.id = p_game returning * into v_g;
  return v_g;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'ddz_open(bigint)', 'ddz_sit(bigint, integer)', 'ddz_stand(bigint)', 'ddz_set_bot(bigint, integer, boolean)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ============================================================
-- 成员离开 / 被移出：座位处理（不改 leave_group / remove_group_member，用触发器）
--   等人时：座位空出来；没有真人了就关桌
--   对局中：这个座位永久变成托管（机器人座位，名字显示成机器人）；没有真人了就关桌
--   他的手牌行删掉（他看不到任何牌了）
-- ============================================================

create or replace function public.ddz_member_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  g       public.ddz_games;
  v_seats uuid[];
  v_bots  boolean[];
  v_auto  boolean[];
  v_left  integer;
  i       integer;
begin
  for g in
    select * from public.ddz_games x
     where x.group_id = old.group_id and x.status in ('waiting', 'bidding', 'playing') and old.user_id = any(x.seats)
     for update
  loop
    v_seats := g.seats; v_bots := g.bots; v_auto := g.auto; v_left := 0;
    for i in 1..3 loop
      if v_seats[i] = old.user_id then
        v_seats[i] := null;
        if g.status <> 'waiting' then
          v_bots[i] := true;
          v_auto[i] := true;
        end if;
      end if;
      if v_seats[i] is not null then v_left := v_left + 1; end if;
    end loop;
    update public.ddz_games x
       set seats = v_seats, bots = v_bots, auto = v_auto,
           status = case when v_left = 0 then 'closed' else x.status end,
           deadline = case when v_left = 0 then null else x.deadline end,
           version = x.version + 1, updated_at = now()
     where x.id = g.id;
  end loop;
  delete from public.ddz_hands h
   using public.ddz_games x
   where h.game_id = x.id and x.group_id = old.group_id and h.user_id = old.user_id;
  return old;
end;
$$;
revoke execute on function public.ddz_member_removed() from public, anon, authenticated;

drop trigger if exists ddz_member_removed on public.group_members;
create trigger ddz_member_removed
  after delete on public.group_members
  for each row execute function public.ddz_member_removed();

-- ============================================================
-- 原子提交（只给 Edge Function 的 service role）
--   p_version：调用者读到的 version；对不上（别人先改了）返回 false，调用者重读重试
--   p_patch：{ status, pub, auto, round, deadline }
--   p_hands：[{ seat, user_id, round, cards }]（只有真人座位）
--   p_scores：[{ user_id, delta, win }]（对局结束时）
--   p_line：对局结束时写进群里的系统提示行；p_actor 是发这行的真人座位（外键需要一个真人）
-- ============================================================

create or replace function public.ddz_commit(
  p_game bigint, p_version integer, p_patch jsonb, p_state jsonb, p_hands jsonb, p_scores jsonb, p_line text, p_actor uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g public.ddz_games;
  h   jsonb;
  s   jsonb;
begin
  select * into v_g from public.ddz_games x where x.id = p_game for update;
  if not found then
    raise exception 'table_not_found';
  end if;
  if v_g.version <> p_version then
    return false;
  end if;

  begin
    update public.ddz_games x
       set status   = p_patch ->> 'status',
           pub      = coalesce(p_patch -> 'pub', x.pub),
           auto     = coalesce((select array_agg(e::boolean order by o) from jsonb_array_elements_text(p_patch -> 'auto') with ordinality as t(e, o)), x.auto),
           round    = coalesce((p_patch ->> 'round')::integer, x.round),
           deadline = (p_patch ->> 'deadline')::timestamptz,
           version  = x.version + 1,
           updated_at = now()
     where x.id = p_game;
  exception when unique_violation then
    raise exception 'table_exists';
  end;

  insert into public.ddz_state (game_id, state, updated_at) values (p_game, p_state, now())
  on conflict (game_id) do update set state = excluded.state, updated_at = now();

  for h in select * from jsonb_array_elements(coalesce(p_hands, '[]'::jsonb)) loop
    insert into public.ddz_hands (game_id, seat, user_id, round, cards)
    values (p_game, (h ->> 'seat')::smallint, (h ->> 'user_id')::uuid, coalesce((h ->> 'round')::integer, 0),
            coalesce((select array_agg(e::smallint order by o) from jsonb_array_elements_text(h -> 'cards') with ordinality as t(e, o)), '{}'))
    on conflict (game_id, seat) do update set user_id = excluded.user_id, round = excluded.round, cards = excluded.cards;
  end loop;

  for s in select * from jsonb_array_elements(coalesce(p_scores, '[]'::jsonb)) loop
    insert into public.ddz_scores (group_id, user_id, total, games, wins)
    values (v_g.group_id, (s ->> 'user_id')::uuid, (s ->> 'delta')::integer, 1, case when (s ->> 'win')::boolean then 1 else 0 end)
    on conflict (group_id, user_id) do update
      set total = public.ddz_scores.total + excluded.total,
          games = public.ddz_scores.games + 1,
          wins  = public.ddz_scores.wins + excluded.wins;
  end loop;

  if p_line is not null and p_actor is not null then
    perform public.group_system_line(v_g.group_id, p_actor, p_line);
  end if;
  return true;
end;
$$;
revoke execute on function public.ddz_commit(bigint, integer, jsonb, jsonb, jsonb, jsonb, text, uuid) from public, anon, authenticated;
do $$
declare
  v_role text := 'service' || '_role';
begin
  if exists (select 1 from pg_roles where rolname = v_role) then
    execute format('grant execute on function public.ddz_commit(bigint, integer, jsonb, jsonb, jsonb, jsonb, text, uuid) to %I', v_role);
  end if;
end $$;

-- ============================================================
-- Realtime
-- ============================================================

alter table public.ddz_games  replica identity full;
alter table public.ddz_hands  replica identity full;
alter table public.ddz_scores replica identity full;

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['ddz_games', 'ddz_hands', 'ddz_scores'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  else
    raise notice 'publication supabase_realtime 不存在，跳过 Realtime 配置';
  end if;
end $$;
