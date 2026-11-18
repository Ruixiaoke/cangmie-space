-- 聊天小程序：弹弓大战（双人异步回合制，"+"面板的第二个工具）
-- 由 GitHub Actions（.github/workflows/backend.yml）自动执行；可重复运行
--
-- 对局存在 sling_games，每一发存在 sling_shots，都只能通过三个函数改（没有写策略）：
--   sling_start(对方)           开一局（已有进行中的就直接返回），聊天里发一条 [弹弓大战]#id
--   sling_shoot(局, 回合, ...)  出手：出手方的设备模拟弹道，把落定后的状态一起上传
--   sling_resign(局)            认输
-- 种子（seed，每一回合新的堡垒布局）和风（wind，每一发新的）都由服务器随机，两边看到的一样。

create table if not exists public.sling_games (
  id           bigint generated always as identity primary key,
  player_a     uuid not null references public.profiles (id) on delete cascade,
  player_b     uuid not null references public.profiles (id) on delete cascade,
  status       text not null default 'active'
               constraint sling_games_status_valid check (status in ('active', 'a_won', 'b_won', 'resigned')),
  winner       uuid,
  score_a      int not null default 0,
  score_b      int not null default 0,
  round_no     int not null default 1,
  seed         int not null,
  wind         numeric not null default 0 constraint sling_games_wind_range check (wind between -1 and 1),
  next_player  uuid,
  state        jsonb,
  turn_no      int not null default 1,
  message_id   bigint references public.messages (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint sling_games_distinct_players check (player_a <> player_b),
  constraint sling_games_state_size check (state is null or pg_column_size(state) <= 16384)
);

create index if not exists sling_games_a_idx on public.sling_games (player_a, player_b, id desc);
create index if not exists sling_games_b_idx on public.sling_games (player_b, player_a, id desc);
create index if not exists sling_games_message_idx on public.sling_games (message_id) where message_id is not null;

create table if not exists public.sling_shots (
  id          bigint generated always as identity primary key,
  game_id     bigint not null references public.sling_games (id) on delete cascade,
  shooter     uuid not null references public.profiles (id) on delete cascade,
  turn_no     int not null,
  round_no    int not null,
  seed        int not null,
  ammo        text not null constraint sling_shots_ammo_valid check (ammo in ('carrot', 'snowball', 'chili')),
  angle       numeric not null,
  power       numeric not null,
  wind        numeric not null,
  result      jsonb not null,
  knocked     boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (game_id, turn_no)
);

alter table public.sling_games enable row level security;
alter table public.sling_shots enable row level security;

revoke all on table public.sling_games, public.sling_shots from public, anon, authenticated;
grant select on table public.sling_games, public.sling_shots to authenticated;

drop policy if exists sling_games_select_players on public.sling_games;
create policy sling_games_select_players on public.sling_games
  for select to authenticated
  using (auth.uid() = player_a or auth.uid() = player_b);

drop policy if exists sling_shots_select_players on public.sling_shots;
create policy sling_shots_select_players on public.sling_shots
  for select to authenticated
  using (exists (
    select 1 from public.sling_games g
    where g.id = sling_shots.game_id and (g.player_a = auth.uid() or g.player_b = auth.uid())
  ));

-- 随机种子 / 风
create or replace function public.sling_rand_seed()
returns int language sql volatile set search_path = '' as $$
  select (floor(random() * 2147483646) + 1)::int
$$;
create or replace function public.sling_rand_wind()
returns numeric language sql volatile set search_path = '' as $$
  select round((random() * 2 - 1)::numeric, 2)
$$;
revoke execute on function public.sling_rand_seed() from public, anon, authenticated;
revoke execute on function public.sling_rand_wind() from public, anon, authenticated;

-- 开一局
create or replace function public.sling_start(p_peer uuid)
returns public.sling_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := auth.uid();
  v_game public.sling_games;
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

  perform pg_advisory_xact_lock(hashtextextended('sling' || least(v_me, p_peer)::text || greatest(v_me, p_peer)::text, 0));

  select * into v_game from public.sling_games g
  where g.status = 'active'
    and least(g.player_a, g.player_b) = least(v_me, p_peer)
    and greatest(g.player_a, g.player_b) = greatest(v_me, p_peer)
  order by g.id desc
  limit 1;
  if found then
    return v_game;
  end if;

  insert into public.sling_games (player_a, player_b, next_player, seed, wind)
  values (v_me, p_peer, v_me, public.sling_rand_seed(), public.sling_rand_wind())
  returning * into v_game;

  insert into public.messages (sender_id, receiver_id, body)
  values (v_me, p_peer, '[弹弓大战]#' || v_game.id)
  returning * into v_msg;

  update public.sling_games set message_id = v_msg.id where id = v_game.id
  returning * into v_game;
  return v_game;
end;
$$;

-- 出手。返回 {game, shot_id}
create or replace function public.sling_shoot(
  p_game bigint, p_turn_no int, p_ammo text, p_angle numeric, p_power numeric,
  p_result jsonb, p_knocked boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_game   public.sling_games;
  v_shot   bigint;
  v_is_a   boolean;
  v_sa     int;
  v_sb     int;
  v_won    boolean := false;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_game from public.sling_games g
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
  if p_ammo is null or p_ammo not in ('carrot', 'snowball', 'chili') then
    raise exception 'invalid_ammo';
  end if;
  if p_angle is null or p_angle < -45 or p_angle > 90
     or p_power is null or p_power < 0.05 or p_power > 1
     or p_knocked is null
     or p_result is null or jsonb_typeof(p_result) <> 'object'
     or octet_length(p_result::text) > 16384 then
    raise exception 'invalid_shot';
  end if;

  v_is_a := (v_me = v_game.player_a);
  v_sa := v_game.score_a + case when p_knocked and v_is_a then 1 else 0 end;
  v_sb := v_game.score_b + case when p_knocked and not v_is_a then 1 else 0 end;

  insert into public.sling_shots (game_id, shooter, turn_no, round_no, seed, ammo, angle, power, wind, result, knocked)
  values (v_game.id, v_me, v_game.turn_no, v_game.round_no, v_game.seed, p_ammo, p_angle, p_power, v_game.wind, p_result, p_knocked)
  returning id into v_shot;

  if p_knocked then
    v_won := (v_sa >= 3 or v_sb >= 3);
    update public.sling_games
    set score_a = v_sa, score_b = v_sb,
        round_no = round_no + 1,
        seed = public.sling_rand_seed(),
        state = null,
        status = case when not v_won then 'active' when v_is_a then 'a_won' else 'b_won' end,
        winner = case when v_won then v_me else null end,
        next_player = case when v_won then null when v_is_a then player_b else player_a end,
        wind = public.sling_rand_wind(),
        turn_no = turn_no + 1,
        updated_at = now()
    where id = v_game.id
    returning * into v_game;
  else
    update public.sling_games
    set state = p_result,
        next_player = case when v_is_a then player_b else player_a end,
        wind = public.sling_rand_wind(),
        turn_no = turn_no + 1,
        updated_at = now()
    where id = v_game.id
    returning * into v_game;
  end if;

  return jsonb_build_object('game', to_jsonb(v_game), 'shot_id', v_shot);
end;
$$;

-- 认输：对方获胜
create or replace function public.sling_resign(p_game bigint)
returns public.sling_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := auth.uid();
  v_game public.sling_games;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_game from public.sling_games g
  where g.id = p_game and (g.player_a = v_me or g.player_b = v_me)
  for update;
  if not found then
    raise exception 'game_not_found';
  end if;
  if v_game.status <> 'active' then
    raise exception 'game_over';
  end if;

  update public.sling_games
  set status = 'resigned',
      winner = case when v_me = player_a then player_b else player_a end,
      next_player = null,
      updated_at = now()
  where id = v_game.id
  returning * into v_game;
  return v_game;
end;
$$;

revoke execute on function public.sling_start(uuid) from public, anon;
revoke execute on function public.sling_shoot(bigint, int, text, numeric, numeric, jsonb, boolean) from public, anon;
revoke execute on function public.sling_resign(bigint) from public, anon;
grant execute on function public.sling_start(uuid) to authenticated;
grant execute on function public.sling_shoot(bigint, int, text, numeric, numeric, jsonb, boolean) to authenticated;
grant execute on function public.sling_resign(bigint) to authenticated;

-- Realtime：对局和出手实时推给双方
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['sling_games', 'sling_shots'] loop
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
