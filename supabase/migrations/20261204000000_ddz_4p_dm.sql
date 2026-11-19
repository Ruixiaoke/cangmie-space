-- 斗地主升级：四人局（4 个座位，3 到 4 人一桌，人不够开始时补机器人）+ 私聊（一对好友）也能开桌
-- 由 GitHub Actions 自动执行；可重复运行（整套迁移会跑两遍）
--
-- 线上已有数据怎么升级（先升级数据，再加新约束）：
--   ddz_games.seats / bots / auto   长度 3 -> 4：旧行末尾补一个空座位（null / false），旧桌子的 0..2 号座位原样不动
--   ddz_games.group_id              改成可空；新增 dm_lo / dm_hi（有序的一对好友：dm_lo < dm_hi）；群桌和私聊桌必须二选一
--   ddz_hands.seat                  范围 0..2 -> 0..3
--   ddz_scores                      主键 (group_id, user_id) 拆成两个部分唯一索引：群累计积分 (group_id, user_id)，
--                                   私聊累计积分 (dm_lo, dm_hi, user_id)；旧的群积分行原样保留
-- 座位规则：桌上一共 4 个座位槽。开始时服务器数一下坐了几个（真人 + 机器人）：不够 3 个就往空位补机器人补到 3 个；
--   3 个 = 三人局，4 个 = 四人局。开始时座位按顺序压紧（0..n-1 就是出牌顺序），引擎看到的座位和座位槽一一对应。
--   ddz_commit 的 p_patch 多了可选的 seats / bots，只在开始时写入压紧后的座位。
-- 私聊桌：访问权限 = 这两个人且还是 accepted 好友（ddz_pair_access）；好友关系结束时（删除 / 不再是 accepted）桌子关闭。
-- 私聊里对局结束不写系统提示行：DM 里没有系统作者（author = 'system' 只有群聊渲染），保持聊天记录干净。

-- ============================================================
-- 表：升级
-- ============================================================

alter table public.ddz_games drop constraint if exists ddz_games_seats_len;
alter table public.ddz_games drop constraint if exists ddz_games_bots_len;
alter table public.ddz_games drop constraint if exists ddz_games_auto_len;

update public.ddz_games set seats = array_append(seats, null::uuid) where cardinality(seats) = 3;
update public.ddz_games set bots  = array_append(bots, false)       where cardinality(bots) = 3;
update public.ddz_games set auto  = array_append(auto, false)       where cardinality(auto) = 3;

alter table public.ddz_games alter column seats set default array[null, null, null, null]::uuid[];
alter table public.ddz_games alter column bots  set default array[false, false, false, false];
alter table public.ddz_games alter column auto  set default array[false, false, false, false];

alter table public.ddz_games add constraint ddz_games_seats_len check (cardinality(seats) = 4);
alter table public.ddz_games add constraint ddz_games_bots_len  check (cardinality(bots) = 4);
alter table public.ddz_games add constraint ddz_games_auto_len  check (cardinality(auto) = 4);

alter table public.ddz_games alter column group_id drop not null;
alter table public.ddz_games add column if not exists dm_lo uuid references public.profiles (id) on delete cascade;
alter table public.ddz_games add column if not exists dm_hi uuid references public.profiles (id) on delete cascade;
alter table public.ddz_games drop constraint if exists ddz_games_target_one;
alter table public.ddz_games add constraint ddz_games_target_one check (
  (group_id is not null and dm_lo is null and dm_hi is null)
  or (group_id is null and dm_lo is not null and dm_hi is not null and dm_lo < dm_hi)
);
create index if not exists ddz_games_dm_idx on public.ddz_games (dm_lo, dm_hi, id desc) where dm_lo is not null;
-- 每对好友同时只有一张没结束的桌子
create unique index if not exists ddz_games_one_open_dm
  on public.ddz_games (dm_lo, dm_hi) where dm_lo is not null and status in ('waiting', 'bidding', 'playing');

alter table public.ddz_hands drop constraint if exists ddz_hands_seat_check;
alter table public.ddz_hands add constraint ddz_hands_seat_check check (seat between 0 and 3);

alter table public.ddz_scores drop constraint if exists ddz_scores_pkey;
alter table public.ddz_scores alter column group_id drop not null;
alter table public.ddz_scores add column if not exists dm_lo uuid references public.profiles (id) on delete cascade;
alter table public.ddz_scores add column if not exists dm_hi uuid references public.profiles (id) on delete cascade;
alter table public.ddz_scores drop constraint if exists ddz_scores_target_one;
alter table public.ddz_scores add constraint ddz_scores_target_one check (
  (group_id is not null and dm_lo is null and dm_hi is null)
  or (group_id is null and dm_lo is not null and dm_hi is not null and dm_lo < dm_hi)
);
create unique index if not exists ddz_scores_group_key on public.ddz_scores (group_id, user_id) where group_id is not null;
create unique index if not exists ddz_scores_dm_key on public.ddz_scores (dm_lo, dm_hi, user_id) where dm_lo is not null;

-- ============================================================
-- 权限：私聊桌的访问 = 这两个人，且还是好友
-- ============================================================

create or replace function public.ddz_pair_access(p_lo uuid, p_hi uuid)
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
revoke execute on function public.ddz_pair_access(uuid, uuid) from public, anon;
grant execute on function public.ddz_pair_access(uuid, uuid) to authenticated;

drop policy if exists ddz_games_select_member on public.ddz_games;
create policy ddz_games_select_member on public.ddz_games
  for select to authenticated
  using (
    (group_id is not null and group_id in (select public.my_group_ids()))
    or (dm_lo is not null and public.ddz_pair_access(dm_lo, dm_hi))
  );

drop policy if exists ddz_scores_select_member on public.ddz_scores;
create policy ddz_scores_select_member on public.ddz_scores
  for select to authenticated
  using (
    (group_id is not null and group_id in (select public.my_group_ids()))
    or (dm_lo is not null and public.ddz_pair_access(dm_lo, dm_hi))
  );

-- ============================================================
-- 大厅 RPC（同名同签名，create or replace）
-- ============================================================

-- 群里开桌：和以前一样，只是座位数组变成 4 个
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
  values (p_group, v_me, array[v_me, null, null, null]::uuid[])
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

-- 私聊里开桌（必须是 accepted 好友）：已经有没结束的桌子就直接返回它；否则建桌、开桌的人坐 0 号位，
-- 并以他的身份给对方发一条 [斗地主]#id 邀请消息（和其他私聊小游戏一样走普通消息）
create or replace function public.ddz_open_dm(p_peer uuid)
returns public.ddz_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me  uuid := auth.uid();
  v_lo  uuid;
  v_hi  uuid;
  v_g   public.ddz_games;
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

  update public.ddz_games x
     set status = 'closed', deadline = null, version = x.version + 1, updated_at = now()
   where x.dm_lo = v_lo and x.dm_hi = v_hi and x.status in ('waiting', 'bidding', 'playing') and x.updated_at < now() - interval '6 hours';

  select * into v_g from public.ddz_games x
   where x.dm_lo = v_lo and x.dm_hi = v_hi and x.status in ('waiting', 'bidding', 'playing');
  if found then
    return v_g;
  end if;

  insert into public.ddz_games (dm_lo, dm_hi, created_by, seats)
  values (v_lo, v_hi, v_me, array[v_me, null, null, null]::uuid[])
  returning * into v_g;

  insert into public.messages (sender_id, receiver_id, body)
  values (v_me, p_peer, '[斗地主]#' || v_g.id)
  returning id into v_msg;
  update public.ddz_games x set message_id = v_msg where x.id = v_g.id returning * into v_g;
  return v_g;
end;
$$;

-- 取一张等人的桌子并加锁；检查调用者有权限（群成员 / 私聊双方且还是好友）。p_must_sit：调用者必须已经坐在桌上
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
  if v_g.group_id is not null then
    if not exists (select 1 from public.group_members gm where gm.group_id = v_g.group_id and gm.user_id = v_me) then
      raise exception 'not_group_member';
    end if;
  elsif not public.ddz_pair_access(v_g.dm_lo, v_g.dm_hi) then
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
  for i in 1..4 loop
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
    'ddz_open(bigint)', 'ddz_open_dm(uuid)', 'ddz_sit(bigint, integer)', 'ddz_stand(bigint)', 'ddz_set_bot(bigint, integer, boolean)'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ============================================================
-- 成员离开 / 好友关系结束
-- ============================================================

-- 群成员离开：座位处理同以前（等人时座位空出来；对局中变成托管机器人座位；没有真人了就关桌），现在是 4 个座位
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

-- 好友关系结束（删除，或者不再是 accepted）：这一对的没结束的私聊桌直接关掉，手牌行删掉
-- （两个人都已经没有访问权限了，剩下的人没法继续：关桌最简单，也不会留下没人管的牌局）
create or replace function public.ddz_friendship_ended()
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
  update public.ddz_games x
     set status = 'closed', deadline = null, version = x.version + 1, updated_at = now()
   where x.dm_lo = v_lo and x.dm_hi = v_hi and x.status in ('waiting', 'bidding', 'playing');
  delete from public.ddz_hands h
   using public.ddz_games x
   where h.game_id = x.id and x.dm_lo = v_lo and x.dm_hi = v_hi;
  return coalesce(new, old);
end;
$$;
revoke execute on function public.ddz_friendship_ended() from public, anon, authenticated;

drop trigger if exists ddz_friendship_ended on public.friendships;
create trigger ddz_friendship_ended
  after update of status or delete on public.friendships
  for each row execute function public.ddz_friendship_ended();

-- ============================================================
-- 原子提交：p_patch 多了可选的 seats / bots（开始时座位压紧、补机器人），积分和系统提示行分群 / 私聊
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
           seats    = coalesce((select array_agg(e::uuid order by o) from jsonb_array_elements_text(p_patch -> 'seats') with ordinality as t(e, o)), x.seats),
           bots     = coalesce((select array_agg(e::boolean order by o) from jsonb_array_elements_text(p_patch -> 'bots') with ordinality as t(e, o)), x.bots),
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

  -- 开始时座位重排：先清掉这张桌子的旧手牌行，再按新座位写
  if p_patch ? 'seats' then
    delete from public.ddz_hands dh where dh.game_id = p_game;
  end if;
  for h in select * from jsonb_array_elements(coalesce(p_hands, '[]'::jsonb)) loop
    insert into public.ddz_hands (game_id, seat, user_id, round, cards)
    values (p_game, (h ->> 'seat')::smallint, (h ->> 'user_id')::uuid, coalesce((h ->> 'round')::integer, 0),
            coalesce((select array_agg(e::smallint order by o) from jsonb_array_elements_text(h -> 'cards') with ordinality as t(e, o)), '{}'))
    on conflict (game_id, seat) do update set user_id = excluded.user_id, round = excluded.round, cards = excluded.cards;
  end loop;

  for s in select * from jsonb_array_elements(coalesce(p_scores, '[]'::jsonb)) loop
    if v_g.group_id is not null then
      insert into public.ddz_scores (group_id, user_id, total, games, wins)
      values (v_g.group_id, (s ->> 'user_id')::uuid, (s ->> 'delta')::integer, 1, case when (s ->> 'win')::boolean then 1 else 0 end)
      on conflict (group_id, user_id) where group_id is not null do update
        set total = public.ddz_scores.total + excluded.total,
            games = public.ddz_scores.games + 1,
            wins  = public.ddz_scores.wins + excluded.wins;
    else
      insert into public.ddz_scores (dm_lo, dm_hi, user_id, total, games, wins)
      values (v_g.dm_lo, v_g.dm_hi, (s ->> 'user_id')::uuid, (s ->> 'delta')::integer, 1, case when (s ->> 'win')::boolean then 1 else 0 end)
      on conflict (dm_lo, dm_hi, user_id) where dm_lo is not null do update
        set total = public.ddz_scores.total + excluded.total,
            games = public.ddz_scores.games + 1,
            wins  = public.ddz_scores.wins + excluded.wins;
    end if;
  end loop;

  -- 系统提示行只在群里写（私聊没有系统作者）
  if p_line is not null and p_actor is not null and v_g.group_id is not null then
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
    execute format('grant select on table public.friendships to %I', v_role);
  end if;
end $$;
