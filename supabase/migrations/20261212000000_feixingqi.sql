-- 飞行棋（群聊和私聊里的 2 到 4 人小游戏）：牌桌、群 / 好友对的累计胜场、大厅 RPC、成员离开 / 好友关系结束时的座位处理、排行榜
-- 由 GitHub Actions 自动执行；可重复运行（整套迁移会跑两遍）
--
-- 设计（和斗地主同一套思路，但飞行棋没有秘密信息，所以更简单）：
--   服务器（Edge Function fxq）是唯一的裁判：掷骰子、校验走法、机器人、超时托管、结算都在那里。
--   整局的状态都是公开的，直接放在 fxq_games.pub（飞机位置、轮到谁、骰子、最近 24 条事件用于回放动画），
--   所以没有 ddz_state / ddz_hands 那样的秘密表：真人通过 select + Realtime 看到整张桌子。
--   fxq_games   牌桌：座位（座位号 0..3 = 红 黄 蓝 绿，不压紧）、机器人、托管、pub、本回合截止时间 deadline、version（乐观并发）
--   fxq_scores  累计胜场：群里按 (group_id, user_id)，私聊按 (dm_lo, dm_hi, user_id)；只有真人有行，第一名算 1 胜
-- 大厅操作（开桌 / 入座 / 离座 / 加减机器人）在 SQL 里；开始 / 掷骰子 / 选飞机 / 超时托管 / 再来一局在 Edge Function 里，
-- 它们通过 fxq_commit 一次性（原子地）写 fxq_games / fxq_scores / 系统提示行。
-- 桌子属于一个群（group_id）或一对好友（dm_lo < dm_hi，二选一）。私聊桌权限 = 这两个人且还是 accepted 好友。

-- ============================================================
-- 表
-- ============================================================

create table if not exists public.fxq_games (
  id          bigint generated always as identity primary key,
  group_id    bigint      references public.groups (id) on delete cascade,
  dm_lo       uuid        references public.profiles (id) on delete cascade,
  dm_hi       uuid        references public.profiles (id) on delete cascade,
  created_by  uuid        references public.profiles (id) on delete set null,
  message_id  bigint      references public.messages (id) on delete set null,
  status      text        not null default 'waiting'
              constraint fxq_games_status_valid check (status in ('waiting', 'playing', 'over', 'closed')),
  seats       uuid[]      not null default array[null, null, null, null]::uuid[]
              constraint fxq_games_seats_len check (cardinality(seats) = 4),
  bots        boolean[]   not null default array[false, false, false, false]
              constraint fxq_games_bots_len check (cardinality(bots) = 4),
  auto        boolean[]   not null default array[false, false, false, false]
              constraint fxq_games_auto_len check (cardinality(auto) = 4),
  round       integer     not null default 0,
  pub         jsonb       not null default '{}'::jsonb,
  deadline    timestamptz,
  version     integer     not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint fxq_games_target_one check (
    (group_id is not null and dm_lo is null and dm_hi is null)
    or (group_id is null and dm_lo is not null and dm_hi is not null and dm_lo < dm_hi)
  )
);
create index if not exists fxq_games_group_idx on public.fxq_games (group_id, id desc) where group_id is not null;
create index if not exists fxq_games_dm_idx on public.fxq_games (dm_lo, dm_hi, id desc) where dm_lo is not null;
-- 每个群 / 每对好友同时只有一张没结束的桌子
create unique index if not exists fxq_games_one_open
  on public.fxq_games (group_id) where group_id is not null and status in ('waiting', 'playing');
create unique index if not exists fxq_games_one_open_dm
  on public.fxq_games (dm_lo, dm_hi) where dm_lo is not null and status in ('waiting', 'playing');

create table if not exists public.fxq_scores (
  group_id  bigint  references public.groups (id) on delete cascade,
  dm_lo     uuid    references public.profiles (id) on delete cascade,
  dm_hi     uuid    references public.profiles (id) on delete cascade,
  user_id   uuid    not null references public.profiles (id) on delete cascade,
  wins      integer not null default 0,
  games     integer not null default 0,
  constraint fxq_scores_target_one check (
    (group_id is not null and dm_lo is null and dm_hi is null)
    or (group_id is null and dm_lo is not null and dm_hi is not null and dm_lo < dm_hi)
  )
);
create unique index if not exists fxq_scores_group_key on public.fxq_scores (group_id, user_id) where group_id is not null;
create unique index if not exists fxq_scores_dm_key on public.fxq_scores (dm_lo, dm_hi, user_id) where dm_lo is not null;
create index if not exists fxq_scores_user_idx on public.fxq_scores (user_id);

-- ============================================================
-- 权限
-- ============================================================

-- 私聊桌的访问 = 这两个人，且还是好友
create or replace function public.fxq_pair_access(p_lo uuid, p_hi uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_lo is not null and p_hi is not null
    and (select auth.uid()) in (p_lo, p_hi)
    and exists (
      select 1 from public.friendships f
       where f.status = 'accepted'
         and least(f.requester_id, f.addressee_id) = p_lo
         and greatest(f.requester_id, f.addressee_id) = p_hi
    );
$$;
revoke execute on function public.fxq_pair_access(uuid, uuid) from public, anon;
grant execute on function public.fxq_pair_access(uuid, uuid) to authenticated;

revoke all on table public.fxq_games, public.fxq_scores from public, anon, authenticated;
grant select on table public.fxq_games, public.fxq_scores to authenticated;
alter table public.fxq_games  enable row level security;
alter table public.fxq_scores enable row level security;

drop policy if exists fxq_games_select_member on public.fxq_games;
create policy fxq_games_select_member on public.fxq_games
  for select to authenticated
  using (
    (group_id is not null and group_id in (select public.my_group_ids()))
    or (dm_lo is not null and public.fxq_pair_access(dm_lo, dm_hi))
  );

drop policy if exists fxq_scores_select_member on public.fxq_scores;
create policy fxq_scores_select_member on public.fxq_scores
  for select to authenticated
  using (
    (group_id is not null and group_id in (select public.my_group_ids()))
    or (dm_lo is not null and public.fxq_pair_access(dm_lo, dm_hi))
  );

-- Edge Function 用的后端角色：云端不一定默认给新表权限，本地裸 Postgres 可能没有这个角色
do $$
declare
  v_role text := 'service' || '_role';
begin
  if exists (select 1 from pg_roles where rolname = v_role) then
    execute format('grant select, insert, update, delete on table public.fxq_games, public.fxq_scores to %I', v_role);
    execute format('grant select on table public.groups, public.group_members, public.profiles, public.friendships to %I', v_role);
    execute format('grant insert on table public.messages to %I', v_role);
    execute format('grant select on table public.push_subscriptions to %I', v_role);
  end if;
end $$;

-- ============================================================
-- 大厅 RPC
-- ============================================================

-- 群里开桌（每个群一张）：已经有没结束的桌子就直接返回它；否则建桌、开桌的人坐 0 号位，并以他的身份在群里发 [飞行棋]#id 卡片
-- 超过 6 小时没有任何动静的旧桌子视为被丢下了，先关掉
create or replace function public.fxq_open(p_group bigint)
returns public.fxq_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me  uuid := auth.uid();
  v_g   public.fxq_games;
  v_msg bigint;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  perform 1 from public.groups gr where gr.id = p_group for update; -- 同一个群的开桌排队
  if not found or not exists (select 1 from public.group_members gm where gm.group_id = p_group and gm.user_id = v_me) then
    raise exception 'not_group_member';
  end if;

  update public.fxq_games x
     set status = 'closed', deadline = null, version = x.version + 1, updated_at = now()
   where x.group_id = p_group and x.status in ('waiting', 'playing') and x.updated_at < now() - interval '6 hours';

  select * into v_g from public.fxq_games x
   where x.group_id = p_group and x.status in ('waiting', 'playing');
  if found then
    return v_g;
  end if;

  insert into public.fxq_games (group_id, created_by, seats)
  values (p_group, v_me, array[v_me, null, null, null]::uuid[])
  returning * into v_g;

  insert into public.messages (sender_id, group_id, body)
  values (v_me, p_group, '[飞行棋]#' || v_g.id)
  returning id into v_msg;
  update public.fxq_games x set message_id = v_msg where x.id = v_g.id returning * into v_g;
  update public.group_members gm set last_read_id = greatest(gm.last_read_id, v_msg)
   where gm.group_id = p_group and gm.user_id = v_me;
  update public.groups gr set updated_at = now() where gr.id = p_group;
  return v_g;
end;
$$;

-- 私聊里开桌（必须是 accepted 好友）：已经有没结束的桌子就直接返回它；否则建桌、开桌的人坐 0 号位，
-- 并以他的身份给对方发一条 [飞行棋]#id 邀请消息（和其他私聊小游戏一样走普通消息）
create or replace function public.fxq_open_dm(p_peer uuid)
returns public.fxq_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me  uuid := auth.uid();
  v_lo  uuid;
  v_hi  uuid;
  v_g   public.fxq_games;
  v_msg bigint;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_peer is null or p_peer = v_me or not exists (
    select 1 from public.friendships f
     where f.status = 'accepted'
       and least(f.requester_id, f.addressee_id) = least(v_me, p_peer)
       and greatest(f.requester_id, f.addressee_id) = greatest(v_me, p_peer)
  ) then
    raise exception 'not_friends';
  end if;
  v_lo := least(v_me, p_peer);
  v_hi := greatest(v_me, p_peer);

  -- 同一对好友的开桌排队（别的小游戏也用同样的锁）
  perform pg_advisory_xact_lock(hashtextextended(v_lo::text || v_hi::text, 0));

  update public.fxq_games x
     set status = 'closed', deadline = null, version = x.version + 1, updated_at = now()
   where x.dm_lo = v_lo and x.dm_hi = v_hi and x.status in ('waiting', 'playing') and x.updated_at < now() - interval '6 hours';

  select * into v_g from public.fxq_games x
   where x.dm_lo = v_lo and x.dm_hi = v_hi and x.status in ('waiting', 'playing');
  if found then
    return v_g;
  end if;

  insert into public.fxq_games (dm_lo, dm_hi, created_by, seats)
  values (v_lo, v_hi, v_me, array[v_me, null, null, null]::uuid[])
  returning * into v_g;

  insert into public.messages (sender_id, receiver_id, body)
  values (v_me, p_peer, '[飞行棋]#' || v_g.id)
  returning id into v_msg;
  update public.fxq_games x set message_id = v_msg where x.id = v_g.id returning * into v_g;
  return v_g;
end;
$$;

-- 取一张等人的桌子并加锁；检查调用者有权限（群成员 / 私聊双方且还是好友）。p_must_sit：调用者必须已经坐在桌上
create or replace function public.fxq_lock_waiting(p_game bigint, p_must_sit boolean)
returns public.fxq_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_g  public.fxq_games;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into v_g from public.fxq_games x where x.id = p_game for update;
  if not found then
    raise exception 'table_not_found';
  end if;
  if v_g.group_id is not null then
    if not exists (select 1 from public.group_members gm where gm.group_id = v_g.group_id and gm.user_id = v_me) then
      raise exception 'not_group_member';
    end if;
  elsif not public.fxq_pair_access(v_g.dm_lo, v_g.dm_hi) then
    raise exception 'not_friends';
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
revoke execute on function public.fxq_lock_waiting(bigint, boolean) from public, anon, authenticated;

-- 入座：座位必须是空的（没有真人也没有机器人）；我已经坐在别的座位就换过去
create or replace function public.fxq_sit(p_game bigint, p_seat integer)
returns public.fxq_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_g     public.fxq_games;
  v_seats uuid[];
  i       integer;
begin
  v_g := public.fxq_lock_waiting(p_game, false);
  if p_seat is null or p_seat not between 0 and 3 then
    raise exception 'invalid_seat';
  end if;
  if v_g.seats[p_seat + 1] is not null or v_g.bots[p_seat + 1] then
    if v_g.seats[p_seat + 1] = v_me then
      return v_g; -- 本来就坐在这里
    end if;
    raise exception 'seat_taken';
  end if;
  v_seats := v_g.seats;
  for i in 1..4 loop
    if v_seats[i] = v_me then v_seats[i] := null; end if;
  end loop;
  v_seats[p_seat + 1] := v_me;
  update public.fxq_games x set seats = v_seats, version = x.version + 1, updated_at = now()
   where x.id = p_game returning * into v_g;
  return v_g;
end;
$$;

-- 离座（只能在等人的时候）；最后一个真人离开时整张桌子关掉
create or replace function public.fxq_stand(p_game bigint)
returns public.fxq_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_g     public.fxq_games;
  v_seats uuid[];
  i       integer;
  v_left  integer := 0;
begin
  v_g := public.fxq_lock_waiting(p_game, true);
  v_seats := v_g.seats;
  for i in 1..4 loop
    if v_seats[i] = v_me then v_seats[i] := null; end if;
    if v_seats[i] is not null then v_left := v_left + 1; end if;
  end loop;
  update public.fxq_games x
     set seats = v_seats,
         status = case when v_left = 0 then 'closed' else x.status end,
         version = x.version + 1, updated_at = now()
   where x.id = p_game returning * into v_g;
  return v_g;
end;
$$;

-- 加 / 移除机器人：任何坐在桌上的人；只能加在空座位上，只能移除机器人
create or replace function public.fxq_set_bot(p_game bigint, p_seat integer, p_on boolean)
returns public.fxq_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g    public.fxq_games;
  v_bots boolean[];
begin
  v_g := public.fxq_lock_waiting(p_game, true);
  if p_seat is null or p_seat not between 0 and 3 or p_on is null then
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
  update public.fxq_games x set bots = v_bots, version = x.version + 1, updated_at = now()
   where x.id = p_game returning * into v_g;
  return v_g;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'fxq_open(bigint)', 'fxq_open_dm(uuid)', 'fxq_sit(bigint, integer)', 'fxq_stand(bigint)', 'fxq_set_bot(bigint, integer, boolean)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ============================================================
-- 成员离开 / 被移出（群）、好友关系结束（私聊）
--   群成员：等人时座位空出来；对局中这个座位永久变成托管的机器人座位；没有真人了就关桌
--   好友关系结束：这一对的没结束的私聊桌直接关掉
-- ============================================================

create or replace function public.fxq_member_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  g       public.fxq_games;
  v_seats uuid[];
  v_bots  boolean[];
  v_auto  boolean[];
  v_left  integer;
  i       integer;
begin
  for g in
    select * from public.fxq_games x
     where x.group_id = old.group_id and x.status in ('waiting', 'playing') and old.user_id = any(x.seats)
     for update
  loop
    v_seats := g.seats; v_bots := g.bots; v_auto := g.auto; v_left := 0;
    for i in 1..4 loop
      if v_seats[i] = old.user_id then
        v_seats[i] := null;
        if g.status <> 'waiting' then
          v_bots[i] := true;
          v_auto[i] := true;
        end if;
      end if;
      if v_seats[i] is not null then v_left := v_left + 1; end if;
    end loop;
    update public.fxq_games x
       set seats = v_seats, bots = v_bots, auto = v_auto,
           status = case when v_left = 0 then 'closed' else x.status end,
           deadline = case when v_left = 0 then null else x.deadline end,
           version = x.version + 1, updated_at = now()
     where x.id = g.id;
  end loop;
  return old;
end;
$$;
revoke execute on function public.fxq_member_removed() from public, anon, authenticated;

drop trigger if exists fxq_member_removed on public.group_members;
create trigger fxq_member_removed
  after delete on public.group_members
  for each row execute function public.fxq_member_removed();

create or replace function public.fxq_friendship_ended()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lo uuid := least(old.requester_id, old.addressee_id);
  v_hi uuid := greatest(old.requester_id, old.addressee_id);
begin
  if old.status <> 'accepted' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.status = 'accepted' then
    return new;
  end if;
  update public.fxq_games x
     set status = 'closed', deadline = null, version = x.version + 1, updated_at = now()
   where x.dm_lo = v_lo and x.dm_hi = v_hi and x.status in ('waiting', 'playing');
  return coalesce(new, old);
end;
$$;
revoke execute on function public.fxq_friendship_ended() from public, anon, authenticated;

drop trigger if exists fxq_friendship_ended on public.friendships;
create trigger fxq_friendship_ended
  after update of status or delete on public.friendships
  for each row execute function public.fxq_friendship_ended();

-- ============================================================
-- 原子提交（只给 Edge Function 的 service role）
--   p_version：调用者读到的 version；对不上（别人先改了）返回 false，调用者重读重试
--   p_patch：{ status, pub, auto, round, deadline }
--   p_scores：[{ user_id, win }]（对局结束时：每个真人 +1 局，第一名 +1 胜）
--   p_line：对局结束时写进群里的系统提示行（私聊里没有系统作者，传 null）；p_actor 是发这行的真人座位（外键需要一个真人）
-- ============================================================

create or replace function public.fxq_commit(
  p_game bigint, p_version integer, p_patch jsonb, p_scores jsonb, p_line text, p_actor uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_g public.fxq_games;
  s   jsonb;
begin
  select * into v_g from public.fxq_games x where x.id = p_game for update;
  if not found then
    raise exception 'table_not_found';
  end if;
  if v_g.version <> p_version then
    return false;
  end if;

  update public.fxq_games x
     set status   = p_patch ->> 'status',
         pub      = coalesce(p_patch -> 'pub', x.pub),
         auto     = coalesce((select array_agg(e::boolean order by o) from jsonb_array_elements_text(p_patch -> 'auto') with ordinality as t(e, o)), x.auto),
         round    = coalesce((p_patch ->> 'round')::integer, x.round),
         deadline = (p_patch ->> 'deadline')::timestamptz,
         version  = x.version + 1,
         updated_at = now()
   where x.id = p_game;

  for s in select * from jsonb_array_elements(coalesce(p_scores, '[]'::jsonb)) loop
    if v_g.group_id is not null then
      insert into public.fxq_scores (group_id, user_id, wins, games)
      values (v_g.group_id, (s ->> 'user_id')::uuid, case when (s ->> 'win')::boolean then 1 else 0 end, 1)
      on conflict (group_id, user_id) where group_id is not null do update
        set wins  = public.fxq_scores.wins + excluded.wins,
            games = public.fxq_scores.games + 1;
    else
      insert into public.fxq_scores (dm_lo, dm_hi, user_id, wins, games)
      values (v_g.dm_lo, v_g.dm_hi, (s ->> 'user_id')::uuid, case when (s ->> 'win')::boolean then 1 else 0 end, 1)
      on conflict (dm_lo, dm_hi, user_id) where dm_lo is not null do update
        set wins  = public.fxq_scores.wins + excluded.wins,
            games = public.fxq_scores.games + 1;
    end if;
  end loop;

  -- 系统提示行只在群里写（私聊没有系统作者）
  if p_line is not null and p_actor is not null and v_g.group_id is not null then
    perform public.group_system_line(v_g.group_id, p_actor, p_line);
  end if;
  return true;
end;
$$;
revoke execute on function public.fxq_commit(bigint, integer, jsonb, jsonb, text, uuid) from public, anon, authenticated;
do $$
declare
  v_role text := 'service' || '_role';
begin
  if exists (select 1 from pg_roles where rolname = v_role) then
    execute format('grant execute on function public.fxq_commit(bigint, integer, jsonb, jsonb, text, uuid) to %I', v_role);
  end if;
end $$;

-- ============================================================
-- 排行榜：按胜场排名（fxq_leaderboard），不新增表：直接从 fxq_scores 算
--   p_group 为空：好友榜。范围 = 我 + 我所有已接受的好友，每个人把自己在所有桌子（所有群和私聊对）上的 wins / games 加起来
--   p_group 有值：本群榜。范围 = 这个群的成员，只算这个群自己的行；调用者必须是群成员，否则 not_group_member
-- 只有真人有 fxq_scores 行。一局都没打过的人不出现，只有我自己例外（没打过也显示，0 胜）。
-- 排序：胜场多、局数少、昵称。不改 game_leaderboard 的签名和 game_win_events。
-- ============================================================

create or replace function public.fxq_leaderboard(p_group bigint default null)
returns table (user_id uuid, nickname text, avatar_path text, wins bigint, games bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if p_group is not null then
    if not exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = v_me) then
      raise exception 'not_group_member';
    end if;
    return query
    with tot as (
      select s.user_id as uid, sum(s.wins) as w, sum(s.games) as g
      from public.fxq_scores s
      where s.group_id = p_group
        and s.user_id in (select m.user_id from public.group_members m where m.group_id = p_group)
      group by s.user_id
    )
    select p.id, p.nickname, p.avatar_path, coalesce(t.w, 0)::bigint, coalesce(t.g, 0)::bigint
    from public.profiles p
    left join tot t on t.uid = p.id
    where p.id = v_me or t.g > 0
    order by coalesce(t.w, 0) desc, coalesce(t.g, 0) asc, p.nickname asc, p.id asc;
    return;
  end if;

  return query
  with ppl as (
    select v_me as uid
    union
    select case when f.requester_id = v_me then f.addressee_id else f.requester_id end
    from public.friendships f
    where f.status = 'accepted' and v_me in (f.requester_id, f.addressee_id)
  ),
  tot as (
    select s.user_id as uid, sum(s.wins) as w, sum(s.games) as g
    from public.fxq_scores s
    where s.user_id in (select uid from ppl)
    group by s.user_id
  )
  select p.id, p.nickname, p.avatar_path, coalesce(t.w, 0)::bigint, coalesce(t.g, 0)::bigint
  from ppl
  join public.profiles p on p.id = ppl.uid
  left join tot t on t.uid = ppl.uid
  where ppl.uid = v_me or t.g > 0
  order by coalesce(t.w, 0) desc, coalesce(t.g, 0) asc, p.nickname asc, p.id asc;
end;
$$;

revoke execute on function public.fxq_leaderboard(bigint) from public, anon;
grant execute on function public.fxq_leaderboard(bigint) to authenticated;

-- ============================================================
-- Realtime
-- ============================================================

alter table public.fxq_games  replica identity full;
alter table public.fxq_scores replica identity full;

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['fxq_games', 'fxq_scores'] loop
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
