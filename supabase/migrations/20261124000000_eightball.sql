-- 聊天小程序：台球加一个 8球 模式（在 9球 的对局表上扩展，9球 的行为不变）
-- 由 GitHub Actions（.github/workflows/backend.yml）自动执行；可重复运行
--
-- pool_games.mode           'nine'（默认，旧数据都是这个）| 'eight'
-- pool_games.group_a        8球：A 选到的球组（'solid' 全色 1-7 | 'stripe' 花色 9-15），B 是另一组；没分组时为空，每盘重置
-- pool_shots.lost           8球：出杆方在这一杆输掉了这盘（8 号提前落袋，或打 8 号时犯规）
-- pool_shots.grp            8球：这一杆给出杆方定下的球组（对手重放时用来提示）
--
-- pool_start(对方, 模式)      开局时选模式；已有进行中的局就直接返回那一局（不换模式）
-- pool_shoot(..., 球组, 输)   出杆方的设备判定：p_group = 这一杆定下的出杆方球组；p_lose = 出杆方输了这盘
--                             9球 模式下这两个参数直接忽略（旧客户端不传也行）
-- pool_rematch                再来一盘，模式不变，球组清空
-- game_leaderboard            'pool' 只算 9球，新增 'pool8' 只算 8球
--
-- 8球 规则（休闲版，不用叫袋）由出杆方设备判定（pool-sim.js 的 poolJudge8），服务器只检查结果自洽：
--   开球不分组、不输赢；开球后第一次合法进球的球组归出杆方；
--   打进 8 号：自己的球组已经清空且这一杆没犯规 = 赢，否则 = 输（对方记一分）

alter table public.pool_games add column if not exists mode text not null default 'nine'
  constraint pool_games_mode_valid check (mode in ('nine', 'eight'));
alter table public.pool_games add column if not exists group_a text
  constraint pool_games_group_valid check (group_a is null or group_a in ('solid', 'stripe'));
alter table public.pool_shots add column if not exists lost boolean not null default false;
alter table public.pool_shots add column if not exists grp text
  constraint pool_shots_grp_valid check (grp is null or grp in ('solid', 'stripe'));

-- 旧签名删掉（带默认值的新签名会和它们在同样的调用下产生歧义）
drop function if exists public.pool_start(uuid);
drop function if exists public.pool_shoot(bigint, int, numeric, numeric, numeric, numeric, numeric, jsonb, int[], text, boolean, boolean);

create or replace function public.pool_start(p_peer uuid, p_mode text default 'nine')
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
  if p_mode is null or p_mode not in ('nine', 'eight') then
    raise exception 'invalid_argument';
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

  insert into public.pool_games (player_a, player_b, next_player, seed, mode)
  values (v_me, p_peer, v_me, public.pool_rand_seed(), p_mode)
  returning * into v_game;

  insert into public.messages (sender_id, receiver_id, body)
  values (v_me, p_peer, case when p_mode = 'eight' then '[8球台球]#' else '[9球台球]#' end || v_game.id)
  returning * into v_msg;

  update public.pool_games set message_id = v_msg.id where id = v_game.id
  returning * into v_game;
  return v_game;
end;
$$;

-- 出杆。返回 {game, shot_id}
-- 参数同 9球；p_group / p_lose 只在 8球 模式下生效（9球 忽略）：
--   p_group: 这一杆给出杆方定下的球组（只能在还没分组、非开球、没犯规、合法进球继续出杆时给）
--   p_lose:  出杆方输了这盘（和 p_win / p_keep 互斥）；对方记一分
-- 8球 的 p_win = 合法打进 8 号：必须已有球组、出杆前自己的球组已经清空、没犯规
create or replace function public.pool_shoot(
  p_game bigint, p_turn_no int, p_dx numeric, p_dy numeric, p_power numeric,
  p_cue_x numeric, p_cue_y numeric,
  p_result jsonb, p_potted int[], p_foul text, p_win boolean, p_keep boolean,
  p_group text default null, p_lose boolean default false
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
  v_eight  boolean;
  v_maxid  int;
  v_dec    int;          -- 决胜球：9球 = 9，8球 = 8
  v_grp_a  text;         -- 这一杆之后的 A 球组
  v_mine   text;         -- 出杆方（这一杆之后）的球组
  v_lose   boolean;
  v_group  text;
  v_over   boolean;
  v_winner uuid;
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

  v_eight := (v_game.mode = 'eight');
  v_maxid := case when v_eight then 15 else 9 end;
  v_dec := case when v_eight then 8 else 9 end;
  v_is_a := (v_me = v_game.player_a);
  -- 9球 模式：这两个参数忽略
  v_lose := v_eight and coalesce(p_lose, false);
  v_group := case when v_eight then p_group else null end;

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
     or (v_lose and (p_win or p_keep))
     or (v_group is not null and v_group not in ('solid', 'stripe'))
     or p_potted is null or cardinality(p_potted) > v_maxid + 1 then
    raise exception 'invalid_shot';
  end if;
  foreach v_id in array p_potted loop
    if v_id is null or v_id < 0 or v_id > v_maxid or v_id = any (v_ids) then
      raise exception 'invalid_shot';
    end if;
    v_ids := v_ids || v_id;
  end loop;
  if p_win and not (v_dec = any (p_potted)) then
    raise exception 'invalid_shot';
  end if;
  if v_lose and not (8 = any (p_potted)) then
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
     or octet_length(p_result::text) > 4096 or jsonb_array_length(p_result -> 'b') > v_maxid + 1 then
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
    if (v_el ->> 0)::numeric <> v_id or v_id < 0 or v_id > v_maxid or v_id = any (v_ids)
       or v_x < c_r - 0.01 or v_x > c_w - c_r + 0.01 or v_y < c_r - 0.01 or v_y > c_h - c_r + 0.01 then
      raise exception 'invalid_shot';
    end if;
    v_ids := v_ids || v_id;
    v_n := v_n + 1;
    if v_id = 0 then v_cues := v_cues + 1; end if;
  end loop;
  -- 犯规：白球拿起来（给对手自由球）；没犯规：白球必须还在台面上
  -- （8球 输掉这盘时如果是犯规，同样白球拿起来；盘已经结束，台面只是个记录）
  if (p_foul is not null and v_cues <> 0) or (p_foul is null and v_cues <> 1) then
    raise exception 'invalid_shot';
  end if;
  -- 赢下这盘球：决胜球不能还在台面上
  if p_win and v_dec = any (v_ids) then
    raise exception 'invalid_shot';
  end if;
  -- 8球：输掉这盘时 8 号也已经不在台面上；没输没赢时 8 号只有开球才可能落袋（放回置球点，所以还在台面上）
  if v_eight then
    if v_lose and 8 = any (v_ids) then
      raise exception 'invalid_shot';
    end if;
    if not v_lose and not p_win and 8 = any (p_potted) and (v_game.state is not null or not (8 = any (v_ids))) then
      raise exception 'invalid_shot';
    end if;
    -- 开球（台面还是摆好的球）不分组也不判输赢
    if v_game.state is null and (v_lose or p_win or v_group is not null) then
      raise exception 'invalid_shot';
    end if;
  end if;

  -- 8球 球组：只能在还没分组时给，必须是合法进球后继续出杆，进的球里要有这一组的球
  v_grp_a := v_game.group_a;
  if v_group is not null then
    if v_game.group_a is not null or p_foul is not null or not p_keep
       or not exists (
         select 1 from unnest(p_potted) as u(x)
         where (v_group = 'solid' and x between 1 and 7) or (v_group = 'stripe' and x between 9 and 15)
       ) then
      raise exception 'invalid_shot';
    end if;
    v_grp_a := case when v_is_a then v_group when v_group = 'solid' then 'stripe' else 'solid' end;
  end if;
  v_mine := case when v_grp_a is null then null when v_is_a then v_grp_a when v_grp_a = 'solid' then 'stripe' else 'solid' end;
  -- 8球 赢：必须已有球组，出杆前台面上自己的球组已经清空
  if v_eight and p_win then
    if v_mine is null or exists (
      select 1 from jsonb_array_elements(coalesce(v_game.state -> 'b', '[]'::jsonb)) as t(e)
      where ((v_mine = 'solid' and (e ->> 0)::int between 1 and 7) or (v_mine = 'stripe' and (e ->> 0)::int between 9 and 15))
    ) then
      raise exception 'invalid_shot';
    end if;
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

  v_over := p_win or v_lose;
  v_winner := case when p_win then v_me when v_lose then (case when v_is_a then v_game.player_b else v_game.player_a end) else null end;
  v_next := case when v_over then null when p_keep then v_me when v_is_a then v_game.player_b else v_game.player_a end;

  insert into public.pool_shots (game_id, shooter, turn_no, rack_no, seed, pre, cue_x, cue_y, dx, dy, power, result, potted, foul, keep, won, lost, grp)
  values (v_game.id, v_me, v_game.turn_no, v_game.rack_no, v_game.seed, v_game.state, p_cue_x, p_cue_y, p_dx, p_dy, p_power, p_result, p_potted, p_foul, p_keep, p_win, v_lose, v_group)
  returning id into v_shot;

  update public.pool_games
  set state = p_result,
      in_hand = (p_foul is not null and not v_over),
      last_foul = p_foul,
      next_player = v_next,
      status = case when v_over then 'rack_over' else 'active' end,
      winner = v_winner,
      group_a = v_grp_a,
      score_a = score_a + case when v_over and v_winner = player_a then 1 else 0 end,
      score_b = score_b + case when v_over and v_winner = player_b then 1 else 0 end,
      turn_no = turn_no + 1,
      updated_at = now()
  where id = v_game.id
  returning * into v_game;

  return jsonb_build_object('game', to_jsonb(v_game), 'shot_id', v_shot);
end;
$$;

-- 再来一盘：同 9球，模式不变，球组清空
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
      group_a = null,
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

revoke execute on function public.pool_start(uuid, text) from public, anon;
revoke execute on function public.pool_shoot(bigint, int, numeric, numeric, numeric, numeric, numeric, jsonb, int[], text, boolean, boolean, text, boolean) from public, anon;
revoke execute on function public.pool_rematch(bigint) from public, anon;
grant execute on function public.pool_start(uuid, text) to authenticated;
grant execute on function public.pool_shoot(bigint, int, numeric, numeric, numeric, numeric, numeric, jsonb, int[], text, boolean, boolean, text, boolean) to authenticated;
grant execute on function public.pool_rematch(bigint) to authenticated;

-- 排行榜：'pool' 只算 9球，'pool8' 只算 8球（每赢下一盘算 1 胜；8球 里对方提前打进 8 号也算我赢一盘）
create or replace function public.game_leaderboard(p_game text)
returns table (user_id uuid, nickname text, avatar_path text, wins bigint, losses bigint)
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
  if p_game is null or p_game not in ('ttt', 'sling', 'pool', 'pool8') then
    raise exception 'invalid_argument';
  end if;

  return query
  with ppl as (
    select v_me as uid
    union
    select case when f.requester_id = v_me then f.addressee_id else f.requester_id end
    from public.friendships f
    where f.status = 'accepted' and v_me in (f.requester_id, f.addressee_id)
  ),
  ev as (
    -- 每个参与者每局一行：(谁, 胜几, 负几)
    select g.winner as uid, 1 as w, 0 as l
    from public.ttt_games g
    where p_game = 'ttt' and g.winner is not null
    union all
    select case when g.winner = g.player_x then g.player_o else g.player_x end, 0, 1
    from public.ttt_games g
    where p_game = 'ttt' and g.winner is not null
    union all
    select g.winner, 1, 0
    from public.sling_games g
    where p_game = 'sling' and g.status in ('a_won', 'b_won', 'resigned') and g.winner is not null
    union all
    select case when g.winner = g.player_a then g.player_b else g.player_a end, 0, 1
    from public.sling_games g
    where p_game = 'sling' and g.status in ('a_won', 'b_won', 'resigned') and g.winner is not null
    union all
    select g.player_a, g.score_a, g.score_b
    from public.pool_games g
    where p_game in ('pool', 'pool8') and g.mode = case when p_game = 'pool8' then 'eight' else 'nine' end
    union all
    select g.player_b, g.score_b, g.score_a
    from public.pool_games g
    where p_game in ('pool', 'pool8') and g.mode = case when p_game = 'pool8' then 'eight' else 'nine' end
  ),
  tot as (
    select e.uid, sum(e.w) as w, sum(e.l) as l
    from ev e
    where e.uid in (select uid from ppl)
    group by e.uid
  )
  select p.id, p.nickname, p.avatar_path, coalesce(t.w, 0)::bigint, coalesce(t.l, 0)::bigint
  from ppl
  join public.profiles p on p.id = ppl.uid
  left join tot t on t.uid = ppl.uid
  order by coalesce(t.w, 0) desc, coalesce(t.l, 0) asc, p.nickname asc, p.id asc;
end;
$$;

revoke execute on function public.game_leaderboard(text) from public, anon;
grant execute on function public.game_leaderboard(text) to authenticated;
