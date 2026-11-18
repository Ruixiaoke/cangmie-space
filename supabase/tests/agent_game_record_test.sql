-- agent_game_record（榴莲看两个人的战绩）的测试：和 game_leaderboard 口径一致、只算这两个人、不泄露第三个人
\set ON_ERROR_STOP on
\set QUIET on

delete from auth.users where email like '%@gr-test.local';

create procedure pg_temp.as_user(u uuid) language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false);
  perform set_config('role', 'authenticated', false);
end $$;

create procedure pg_temp.as_anon() language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);
  perform set_config('role', 'anon', false);
end $$;

create function pg_temp.err(q text) returns text language plpgsql as $$
begin
  execute q;
  return 'ok';
exception when others then
  return sqlerrm;
end $$;

-- me、bob 互为好友；carol 是 bob 的另一个好友（战绩不能出现在 me / bob 的记录里）
insert into auth.users (id, email) values
  ('f1000000-0000-0000-0000-0000000000a1', 'gr_me@gr-test.local'),
  ('f1000000-0000-0000-0000-0000000000b1', 'gr_bob@gr-test.local'),
  ('f1000000-0000-0000-0000-0000000000c1', 'gr_carol@gr-test.local');

insert into public.friendships (requester_id, addressee_id, status) values
  ('f1000000-0000-0000-0000-0000000000a1', 'f1000000-0000-0000-0000-0000000000b1', 'accepted'),
  ('f1000000-0000-0000-0000-0000000000b1', 'f1000000-0000-0000-0000-0000000000c1', 'accepted');

-- 井字棋：me 赢 bob 1、bob 赢 me 2、平局 1；bob 赢 carol 1
insert into public.ttt_games (player_x, player_o, status, winner, next_player) values
  ('f1000000-0000-0000-0000-0000000000a1', 'f1000000-0000-0000-0000-0000000000b1', 'x_won', 'f1000000-0000-0000-0000-0000000000a1', null),
  ('f1000000-0000-0000-0000-0000000000a1', 'f1000000-0000-0000-0000-0000000000b1', 'o_won', 'f1000000-0000-0000-0000-0000000000b1', null),
  ('f1000000-0000-0000-0000-0000000000b1', 'f1000000-0000-0000-0000-0000000000a1', 'x_won', 'f1000000-0000-0000-0000-0000000000b1', null),
  ('f1000000-0000-0000-0000-0000000000a1', 'f1000000-0000-0000-0000-0000000000b1', 'draw', null, null),
  ('f1000000-0000-0000-0000-0000000000b1', 'f1000000-0000-0000-0000-0000000000c1', 'x_won', 'f1000000-0000-0000-0000-0000000000b1', null);
-- 弹弓：me 赢 bob 1 场；bob 赢 carol 1 场；进行中的不算
insert into public.sling_games (player_a, player_b, status, winner, score_a, score_b, seed, next_player) values
  ('f1000000-0000-0000-0000-0000000000a1', 'f1000000-0000-0000-0000-0000000000b1', 'a_won', 'f1000000-0000-0000-0000-0000000000a1', 3, 1, 1, null),
  ('f1000000-0000-0000-0000-0000000000a1', 'f1000000-0000-0000-0000-0000000000b1', 'active', null, 2, 2, 1, 'f1000000-0000-0000-0000-0000000000a1'),
  ('f1000000-0000-0000-0000-0000000000b1', 'f1000000-0000-0000-0000-0000000000c1', 'a_won', 'f1000000-0000-0000-0000-0000000000b1', 3, 0, 1, null);
-- 9球：me 对 bob 3-1；bob 对 carol 5-2（进行中也计盘数）
insert into public.pool_games (player_a, player_b, status, winner, score_a, score_b, seed, next_player) values
  ('f1000000-0000-0000-0000-0000000000a1', 'f1000000-0000-0000-0000-0000000000b1', 'rack_over', 'f1000000-0000-0000-0000-0000000000a1', 3, 1, 1, null),
  ('f1000000-0000-0000-0000-0000000000b1', 'f1000000-0000-0000-0000-0000000000c1', 'active', null, 5, 2, 1, 'f1000000-0000-0000-0000-0000000000b1');
-- 8球：me 对 bob 2-1（bob 先手 a 位，所以反着写）；bob 对 carol 0-3
insert into public.pool_games (player_a, player_b, status, winner, score_a, score_b, seed, next_player, mode) values
  ('f1000000-0000-0000-0000-0000000000b1', 'f1000000-0000-0000-0000-0000000000a1', 'rack_over', 'f1000000-0000-0000-0000-0000000000a1', 1, 2, 1, null, 'eight'),
  ('f1000000-0000-0000-0000-0000000000b1', 'f1000000-0000-0000-0000-0000000000c1', 'active', null, 0, 3, 1, 'f1000000-0000-0000-0000-0000000000b1', 'eight');

-- 权限：谁都不能直接调用
call pg_temp.as_anon();
do $$ begin
  if pg_temp.err($q$select * from public.agent_game_record('f1000000-0000-0000-0000-0000000000a1', 'f1000000-0000-0000-0000-0000000000b1', 'ttt')$q$) <> 'permission denied for function agent_game_record' then raise exception 'anon must not call'; end if;
end $$;
call pg_temp.as_user('f1000000-0000-0000-0000-0000000000a1');
do $$ begin
  if pg_temp.err($q$select * from public.agent_game_record('f1000000-0000-0000-0000-0000000000a1', 'f1000000-0000-0000-0000-0000000000b1', 'ttt')$q$) <> 'permission denied for function agent_game_record' then raise exception 'authenticated must not call'; end if;
  if pg_temp.err($q$select * from public.game_win_events('ttt')$q$) <> 'permission denied for function game_win_events' then raise exception 'events helper must be internal'; end if;
end $$;

-- 数字：每个游戏 a_wins-a_losses / b_wins-b_losses / a_h2h-b_h2h
reset role;
create function pg_temp.rec(g text) returns text language sql as $$
  select a_wins || '-' || a_losses || '/' || b_wins || '-' || b_losses || '/' || a_h2h || '-' || b_h2h
  from public.agent_game_record('f1000000-0000-0000-0000-0000000000a1', 'f1000000-0000-0000-0000-0000000000b1', g)
$$;
do $$
declare got text;
begin
  got := pg_temp.rec('ttt');   if got <> '1-2/3-1/1-2' then raise exception 'ttt wrong: %', got; end if;
  got := pg_temp.rec('sling'); if got <> '1-0/1-1/1-0' then raise exception 'sling wrong: %', got; end if;
  got := pg_temp.rec('pool');  if got <> '3-1/6-5/3-1' then raise exception 'pool wrong (nine only): %', got; end if;
  got := pg_temp.rec('pool8'); if got <> '2-1/1-5/2-1' then raise exception 'pool8 wrong (eight only): %', got; end if;
  got := pg_temp.rec('chess'); if got <> '0-0/0-0/0-0' then raise exception 'unknown game must be empty: %', got; end if;
  -- 顺序对调：结果对调
  if (select a_wins from public.agent_game_record('f1000000-0000-0000-0000-0000000000b1', 'f1000000-0000-0000-0000-0000000000a1', 'ttt')) <> 3 then raise exception 'swap wrong'; end if;
  -- 一个没打过的人：全 0，也看不到 carol
  if exists (select 1 from public.agent_game_record('f1000000-0000-0000-0000-0000000000a1', 'f1000000-0000-0000-0000-0000000000c1', 'sling') where a_h2h <> 0 or b_h2h <> 0) then raise exception 'h2h must count only games between the two'; end if;
end $$;

-- 和 game_leaderboard 一致：用 me 的身份取榜，对比 me 和 bob 的总数
call pg_temp.as_user('f1000000-0000-0000-0000-0000000000a1');
create temp table lb_cmp (g text, uid uuid, w bigint, l bigint);
grant all on lb_cmp to authenticated;
insert into lb_cmp select 'ttt', user_id, wins, losses from public.game_leaderboard('ttt');
insert into lb_cmp select 'sling', user_id, wins, losses from public.game_leaderboard('sling');
insert into lb_cmp select 'pool', user_id, wins, losses from public.game_leaderboard('pool');
insert into lb_cmp select 'pool8', user_id, wins, losses from public.game_leaderboard('pool8');
reset role;
do $$
declare gm text; r record; n int;
begin
  foreach gm in array array['ttt', 'sling', 'pool', 'pool8'] loop
    select * into r from public.agent_game_record('f1000000-0000-0000-0000-0000000000a1', 'f1000000-0000-0000-0000-0000000000b1', gm);
    select count(*) into n from lb_cmp c where c.g = gm and ((c.uid = 'f1000000-0000-0000-0000-0000000000a1' and (c.w, c.l) = (r.a_wins, r.a_losses)) or (c.uid = 'f1000000-0000-0000-0000-0000000000b1' and (c.w, c.l) = (r.b_wins, r.b_losses)));
    if n <> 2 then raise exception 'totals differ from game_leaderboard for %', gm; end if;
  end loop;
  -- 返回的列里没有任何第三个人的信息（只有 6 个数字列）
  if (select count(*) from information_schema.parameters where specific_name like 'agent_game_record%' and parameter_mode = 'OUT') <> 6 then raise exception 'unexpected output columns'; end if;
end $$;

delete from auth.users where email like '%@gr-test.local';
select 'agent game record tests ok';
