-- 榴莲：看这两个人的小游戏战绩（只给 Edge Function 的 service role 用）
-- 由 GitHub Actions（.github/workflows/backend.yml）自动执行；可重复运行
--
-- game_win_events(游戏)   内部：每个参与者每局一行 (谁, 对手, 胜几, 负几)，是胜负计数规则的唯一来源，
--                         game_leaderboard 和 agent_game_record 都从它算，两边口径永远一致。
--                         规则见 20261123000000_leaderboard.sql 和 20261124000000_eightball.sql 的注释
--                         （'pool' 只算 9球，'pool8' 只算 8球）。谁都不能直接调用。
-- agent_game_record(a, b, 游戏)  只返回这两个人：各自的总胜 / 负，以及两人之间的交手胜负。
--                         不返回任何第三个人，所以榴莲在聊天里说出来，不会泄露任一方的其他好友。

create or replace function public.game_win_events(p_game text)
returns table (uid uuid, opp uuid, w bigint, l bigint)
language sql
stable
set search_path = ''
as $$
  select g.winner, case when g.winner = g.player_x then g.player_o else g.player_x end, 1::bigint, 0::bigint
  from public.ttt_games g
  where p_game = 'ttt' and g.winner is not null
  union all
  select case when g.winner = g.player_x then g.player_o else g.player_x end, g.winner, 0, 1
  from public.ttt_games g
  where p_game = 'ttt' and g.winner is not null
  union all
  select g.winner, case when g.winner = g.player_a then g.player_b else g.player_a end, 1, 0
  from public.sling_games g
  where p_game = 'sling' and g.status in ('a_won', 'b_won', 'resigned') and g.winner is not null
  union all
  select case when g.winner = g.player_a then g.player_b else g.player_a end, g.winner, 0, 1
  from public.sling_games g
  where p_game = 'sling' and g.status in ('a_won', 'b_won', 'resigned') and g.winner is not null
  union all
  select g.player_a, g.player_b, g.score_a::bigint, g.score_b::bigint
  from public.pool_games g
  where p_game in ('pool', 'pool8') and g.mode = case when p_game = 'pool8' then 'eight' else 'nine' end
  union all
  select g.player_b, g.player_a, g.score_b::bigint, g.score_a::bigint
  from public.pool_games g
  where p_game in ('pool', 'pool8') and g.mode = case when p_game = 'pool8' then 'eight' else 'nine' end
$$;

revoke execute on function public.game_win_events(text) from public, anon, authenticated;

-- 排行榜：行为和以前完全一样，只是计数改从 game_win_events 取
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
  tot as (
    select e.uid, sum(e.w) as w, sum(e.l) as l
    from public.game_win_events(p_game) e
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

create or replace function public.agent_game_record(p_a uuid, p_b uuid, p_game text)
returns table (a_wins bigint, a_losses bigint, b_wins bigint, b_losses bigint, a_h2h bigint, b_h2h bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(sum(e.w) filter (where e.uid = p_a), 0)::bigint,
    coalesce(sum(e.l) filter (where e.uid = p_a), 0)::bigint,
    coalesce(sum(e.w) filter (where e.uid = p_b), 0)::bigint,
    coalesce(sum(e.l) filter (where e.uid = p_b), 0)::bigint,
    coalesce(sum(e.w) filter (where e.uid = p_a and e.opp = p_b), 0)::bigint,
    coalesce(sum(e.w) filter (where e.uid = p_b and e.opp = p_a), 0)::bigint
  from public.game_win_events(case when p_game in ('ttt', 'sling', 'pool', 'pool8') then p_game else '' end) e
  where e.uid in (p_a, p_b)
$$;

revoke execute on function public.agent_game_record(uuid, uuid, text) from public, anon, authenticated;
