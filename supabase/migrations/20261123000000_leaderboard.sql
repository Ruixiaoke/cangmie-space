-- 聊天小程序：胜场排行榜（井字棋 / 弹弓大战 / 9球台球各一张，范围 = 我 + 我的好友）
-- 由 GitHub Actions（.github/workflows/backend.yml）自动执行；可重复运行
--
-- game_leaderboard(游戏) 只读，不新增表：直接从现有对局表算
--   ttt    井字棋：对局已结束且有赢家（含对方认输）算 1 胜，输的一方算 1 负；平局双方都不算
--   sling  弹弓大战：一整场（先到目标分，或对方认输）算 1 胜，不是单次击倒；输的一方算 1 负
--   pool   9球台球：每赢下一盘球算 1 胜（pool_games.score_a / score_b 就是累计的盘数，认输时对方已记 1 分），
--          对手赢的盘数算负；还在打的这一盘还没有结果，不算
-- 返回我自己和所有已接受的好友（没打过的也在，0 胜 0 负），按 胜场多、负场少、昵称 排好序。
-- 好友的战绩只统计他本人的结果，不透露他的对手是谁；非好友不会出现。

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
  if p_game is null or p_game not in ('ttt', 'sling', 'pool') then
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
    where p_game = 'pool'
    union all
    select g.player_b, g.score_b, g.score_a
    from public.pool_games g
    where p_game = 'pool'
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
