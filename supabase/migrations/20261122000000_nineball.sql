-- 聊天小程序：9球台球（双人异步回合制，"+"面板里的工具）
-- 由 GitHub Actions（.github/workflows/backend.yml）自动执行；可重复运行
--
-- 对局存在 pool_games，每一杆存在 pool_shots，都只能通过四个函数改（没有写策略）：
--   pool_start(对方)             开一局（已有进行中或可以再来一局的就直接返回），聊天里发一条 [9球台球]#id
--   pool_shoot(局, 回合, ...)    出杆：出杆方的设备模拟，把输入（方向、力度）和落定后的台面、判定结果一起上传
--   pool_rematch(局)             一局（一盘球）打完或认输之后，再摆一盘；比分保留，开球的人轮换
--   pool_resign(局)              认输
-- 台面状态 state = {"b": [[球号, x, y], ...]}，只含还在台面上的球，0 号 = 白球；没有白球 = 对手有自由球。
-- 开球摆球由客户端按 seed 确定（seed 由服务器随机，两边一样），所以开球时 state 为空。
-- 物理在客户端模拟（确定性的，见 chat/js/miniapps/pool-sim.js），服务器只管：谁的回合、局是否结束、
-- 输入和结果的格式与范围、自由球的摆放位置、判定结果之间自洽（例如犯规 = 没有白球、赢 = 9 号落袋）。

create table if not exists public.pool_games (
  id           bigint generated always as identity primary key,
  player_a     uuid not null references public.profiles (id) on delete cascade,
  player_b     uuid not null references public.profiles (id) on delete cascade,
  status       text not null default 'active'
               constraint pool_games_status_valid check (status in ('active', 'rack_over', 'resigned')),
  winner       uuid,
  score_a      int not null default 0,
  score_b      int not null default 0,
  rack_no      int not null default 1,
  seed         int not null,
  next_player  uuid,
  state        jsonb,
  in_hand      boolean not null default false,
  last_foul    text constraint pool_games_foul_valid check (last_foul is null or last_foul in ('scratch', 'wrong', 'none', 'rail')),
  turn_no      int not null default 1,
  message_id   bigint references public.messages (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint pool_games_distinct_players check (player_a <> player_b),
  constraint pool_games_state_size check (state is null or pg_column_size(state) <= 4096)
);

create index if not exists pool_games_a_idx on public.pool_games (player_a, player_b, id desc);
create index if not exists pool_games_b_idx on public.pool_games (player_b, player_a, id desc);
create index if not exists pool_games_message_idx on public.pool_games (message_id) where message_id is not null;

create table if not exists public.pool_shots (
  id          bigint generated always as identity primary key,
  game_id     bigint not null references public.pool_games (id) on delete cascade,
  shooter     uuid not null references public.profiles (id) on delete cascade,
  turn_no     int not null,
  rack_no     int not null,
  seed        int not null,
  pre         jsonb,                 -- 出杆前的台面（开球时为空，由 seed 摆球）
  cue_x       numeric,               -- 自由球时摆放的白球位置
  cue_y       numeric,
  dx          numeric not null,      -- 出杆方向（单位向量，取整到 1e-6）
  dy          numeric not null,
  power       numeric not null,      -- 力度 0.02 .. 1（取整到 1e-3）
  result      jsonb not null,        -- 落定后的台面
  potted      int[] not null default '{}', -- 这一杆落袋的球（含白球 0）
  foul        text constraint pool_shots_foul_valid check (foul is null or foul in ('scratch', 'wrong', 'none', 'rail')),
  keep        boolean not null default false, -- 这一杆之后还是自己出杆
  won         boolean not null default false, -- 这一杆赢下了这盘球
  created_at  timestamptz not null default now(),
  unique (game_id, turn_no)
);

alter table public.pool_games enable row level security;
alter table public.pool_shots enable row level security;

revoke all on table public.pool_games, public.pool_shots from public, anon, authenticated;
grant select on table public.pool_games, public.pool_shots to authenticated;

drop policy if exists pool_games_select_players on public.pool_games;
create policy pool_games_select_players on public.pool_games
  for select to authenticated
  using (auth.uid() = player_a or auth.uid() = player_b);

drop policy if exists pool_shots_select_players on public.pool_shots;
create policy pool_shots_select_players on public.pool_shots
  for select to authenticated
  using (exists (
    select 1 from public.pool_games g
    where g.id = pool_shots.game_id and (g.player_a = auth.uid() or g.player_b = auth.uid())
  ));

create or replace function public.pool_rand_seed()
returns int language sql volatile set search_path = '' as $$
  select (floor(random() * 2147483646) + 1)::int
$$;
revoke execute on function public.pool_rand_seed() from public, anon, authenticated;

-- 开一局：已有进行中的就直接返回；上一局已经结束（打完一盘 / 认输）则新开一局（比分从 0 开始；同一局里继续打用 pool_rematch）
create or replace function public.pool_start(p_peer uuid)
returns public.pool_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := auth.uid();
  v_game public.pool_games;
  v_msg  public.messages;
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

  perform pg_advisory_xact_lock(hashtextextended('pool' || least(v_me, p_peer)::text || greatest(v_me, p_peer)::text, 0));

  select * into v_game from public.pool_games g
  where g.status = 'active'
    and least(g.player_a, g.player_b) = least(v_me, p_peer)
    and greatest(g.player_a, g.player_b) = greatest(v_me, p_peer)
  order by g.id desc
  limit 1;
  if found then
    return v_game;
  end if;

  insert into public.pool_games (player_a, player_b, next_player, seed)
  values (v_me, p_peer, v_me, public.pool_rand_seed())
  returning * into v_game;

  insert into public.messages (sender_id, receiver_id, body)
  values (v_me, p_peer, '[9球台球]#' || v_game.id)
  returning * into v_msg;

  update public.pool_games set message_id = v_msg.id where id = v_game.id
  returning * into v_game;
  return v_game;
end;
$$;

-- 出杆。返回 {game, shot_id}
-- p_result: {"b": [[球号, x, y], ...]}；p_potted: 这一杆落袋的球；p_foul: 犯规原因或 null；
-- p_win: 这一杆合法打进 9 号，赢下这盘；p_keep: 合法进球，继续出杆
-- p_cue_x/y: 上一杆犯规时（自由球）必须给出白球摆放的位置，否则必须为空
create or replace function public.pool_shoot(
  p_game bigint, p_turn_no int, p_dx numeric, p_dy numeric, p_power numeric,
  p_cue_x numeric, p_cue_y numeric,
  p_result jsonb, p_potted int[], p_foul text, p_win boolean, p_keep boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_game   public.pool_games;
  v_shot   bigint;
  v_is_a   boolean;
  v_el     jsonb;
  v_n      int := 0;
  v_cues   int := 0;
  v_ids    int[] := '{}';
  v_id     int;
  v_x      numeric;
  v_y      numeric;
  v_next   uuid;
  -- 台面：宽 340、高 600，球半径 10.5（和 pool-sim.js 里的常数一致）
  c_w constant numeric := 340;
  c_h constant numeric := 600;
  c_r constant numeric := 10.5;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_game from public.pool_games g
  where g.id = p_game and (g.player_a = v_me or g.player_b = v_me)
  for update;
  if not found then
    raise exception 'game_not_found';
  end if;
  if v_game.status <> 'active' then
    raise exception 'game_over';
  end if;
  if v_game.next_player is distinct from v_me then
    raise exception 'not_your_turn';
  end if;
  if p_turn_no is distinct from v_game.turn_no then
    raise exception 'stale_turn';
  end if;

  -- 出杆输入
  if p_dx is null or p_dy is null or p_power is null
     or p_dx < -1 or p_dx > 1 or p_dy < -1 or p_dy > 1
     or abs(p_dx * p_dx + p_dy * p_dy - 1) > 0.001
     or p_power < 0.02 or p_power > 1 then
    raise exception 'invalid_shot';
  end if;

  -- 判定字段自洽
  if p_win is null or p_keep is null
     or (p_foul is not null and p_foul not in ('scratch', 'wrong', 'none', 'rail'))
     or (p_foul is not null and (p_win or p_keep))
     or (p_win and p_keep)
     or p_potted is null or cardinality(p_potted) > 10 then
    raise exception 'invalid_shot';
  end if;
  foreach v_id in array p_potted loop
    if v_id is null or v_id < 0 or v_id > 9 or v_id = any (v_ids) then
      raise exception 'invalid_shot';
    end if;
    v_ids := v_ids || v_id;
  end loop;
  if p_win and not (9 = any (p_potted)) then
    raise exception 'invalid_shot';
  end if;
  -- 白球落袋 = 犯规（母球落袋），反过来也一样
  if (0 = any (p_potted)) is distinct from coalesce(p_foul = 'scratch', false) then
    raise exception 'invalid_shot';
  end if;
  if p_keep and cardinality(p_potted) = 0 then
    raise exception 'invalid_shot';
  end if;

  -- 落定后的台面
  if p_result is null or jsonb_typeof(p_result) <> 'object' or jsonb_typeof(p_result -> 'b') is distinct from 'array'
     or octet_length(p_result::text) > 4096 or jsonb_array_length(p_result -> 'b') > 10 then
    raise exception 'invalid_shot';
  end if;
  v_ids := '{}';
  for v_el in select e from jsonb_array_elements(p_result -> 'b') as t(e) loop
    if jsonb_typeof(v_el) <> 'array' or jsonb_array_length(v_el) <> 3
       or jsonb_typeof(v_el -> 0) <> 'number' or jsonb_typeof(v_el -> 1) <> 'number' or jsonb_typeof(v_el -> 2) <> 'number' then
      raise exception 'invalid_shot';
    end if;
    v_id := (v_el ->> 0)::numeric::int;
    v_x := (v_el ->> 1)::numeric;
    v_y := (v_el ->> 2)::numeric;
    if (v_el ->> 0)::numeric <> v_id or v_id < 0 or v_id > 9 or v_id = any (v_ids)
       or v_x < c_r - 0.01 or v_x > c_w - c_r + 0.01 or v_y < c_r - 0.01 or v_y > c_h - c_r + 0.01 then
      raise exception 'invalid_shot';
    end if;
    v_ids := v_ids || v_id;
    v_n := v_n + 1;
    if v_id = 0 then v_cues := v_cues + 1; end if;
  end loop;
  -- 犯规：白球拿起来（给对手自由球）；没犯规：白球必须还在台面上
  if (p_foul is not null and v_cues <> 0) or (p_foul is null and v_cues <> 1) then
    raise exception 'invalid_shot';
  end if;
  -- 赢下这盘球：9 号不能还在台面上
  if p_win and 9 = any (v_ids) then
    raise exception 'invalid_shot';
  end if;

  -- 自由球：必须给出白球的位置，在台面内且不压住别的球；否则不能给
  if v_game.in_hand then
    if p_cue_x is null or p_cue_y is null
       or p_cue_x < c_r - 0.01 or p_cue_x > c_w - c_r + 0.01 or p_cue_y < c_r - 0.01 or p_cue_y > c_h - c_r + 0.01 then
      raise exception 'invalid_cue';
    end if;
    for v_el in select e from jsonb_array_elements(coalesce(v_game.state -> 'b', '[]'::jsonb)) as t(e) loop
      v_x := (v_el ->> 1)::numeric - p_cue_x;
      v_y := (v_el ->> 2)::numeric - p_cue_y;
      if (v_el ->> 0)::int <> 0 and v_x * v_x + v_y * v_y < (2 * c_r - 0.05) * (2 * c_r - 0.05) then
        raise exception 'invalid_cue';
      end if;
    end loop;
  elsif p_cue_x is not null or p_cue_y is not null then
    raise exception 'invalid_cue';
  end if;

  v_is_a := (v_me = v_game.player_a);
  v_next := case when p_win then null when p_keep then v_me when v_is_a then v_game.player_b else v_game.player_a end;

  insert into public.pool_shots (game_id, shooter, turn_no, rack_no, seed, pre, cue_x, cue_y, dx, dy, power, result, potted, foul, keep, won)
  values (v_game.id, v_me, v_game.turn_no, v_game.rack_no, v_game.seed, v_game.state, p_cue_x, p_cue_y, p_dx, p_dy, p_power, p_result, p_potted, p_foul, p_keep, p_win)
  returning id into v_shot;

  update public.pool_games
  set state = p_result,
      in_hand = (p_foul is not null),
      last_foul = p_foul,
      next_player = v_next,
      status = case when p_win then 'rack_over' else 'active' end,
      winner = case when p_win then v_me else null end,
      score_a = score_a + case when p_win and v_is_a then 1 else 0 end,
      score_b = score_b + case when p_win and not v_is_a then 1 else 0 end,
      turn_no = turn_no + 1,
      updated_at = now()
  where id = v_game.id
  returning * into v_game;

  return jsonb_build_object('game', to_jsonb(v_game), 'shot_id', v_shot);
end;
$$;

-- 再来一盘：只有这一盘打完（或认输）之后才行；比分保留，开球的人轮换（单数盘 A 开球，双数盘 B 开球）
-- 已经重新开了的话（对手先点了）就直接返回当前这局
create or replace function public.pool_rematch(p_game bigint)
returns public.pool_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := auth.uid();
  v_game public.pool_games;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_game from public.pool_games g
  where g.id = p_game and (g.player_a = v_me or g.player_b = v_me)
  for update;
  if not found then
    raise exception 'game_not_found';
  end if;
  if v_game.status = 'active' then
    return v_game;
  end if;

  update public.pool_games
  set status = 'active',
      winner = null,
      rack_no = rack_no + 1,
      seed = public.pool_rand_seed(),
      state = null,
      in_hand = false,
      last_foul = null,
      next_player = case when (rack_no + 1) % 2 = 1 then player_a else player_b end,
      turn_no = turn_no + 1,
      updated_at = now()
  where id = v_game.id
  returning * into v_game;
  return v_game;
end;
$$;

-- 认输：对方赢下这盘（记一分）
create or replace function public.pool_resign(p_game bigint)
returns public.pool_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := auth.uid();
  v_game public.pool_games;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_game from public.pool_games g
  where g.id = p_game and (g.player_a = v_me or g.player_b = v_me)
  for update;
  if not found then
    raise exception 'game_not_found';
  end if;
  if v_game.status <> 'active' then
    raise exception 'game_over';
  end if;

  update public.pool_games
  set status = 'resigned',
      winner = case when v_me = player_a then player_b else player_a end,
      score_a = score_a + case when v_me = player_b then 1 else 0 end,
      score_b = score_b + case when v_me = player_a then 1 else 0 end,
      next_player = null,
      in_hand = false,
      updated_at = now()
  where id = v_game.id
  returning * into v_game;
  return v_game;
end;
$$;

revoke execute on function public.pool_start(uuid) from public, anon;
revoke execute on function public.pool_shoot(bigint, int, numeric, numeric, numeric, numeric, numeric, jsonb, int[], text, boolean, boolean) from public, anon;
revoke execute on function public.pool_rematch(bigint) from public, anon;
revoke execute on function public.pool_resign(bigint) from public, anon;
grant execute on function public.pool_start(uuid) to authenticated;
grant execute on function public.pool_shoot(bigint, int, numeric, numeric, numeric, numeric, numeric, jsonb, int[], text, boolean, boolean) to authenticated;
grant execute on function public.pool_rematch(bigint) to authenticated;
grant execute on function public.pool_resign(bigint) to authenticated;

-- Realtime：对局和出杆实时推给双方
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['pool_games', 'pool_shots'] loop
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
