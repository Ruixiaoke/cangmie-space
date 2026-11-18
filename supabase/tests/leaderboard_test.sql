-- 胜场排行榜（game_leaderboard）的测试，CI 在临时 Postgres 上运行
-- 自带数据：开头清理上一次的测试用户，结尾再清理
\set ON_ERROR_STOP on
\set QUIET on

delete from auth.users where email like '%@lb-test.local';

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

create procedure pg_temp.expect(q text, expected text) language plpgsql as $$
declare got text := pg_temp.err(q);
begin
  if got is distinct from expected then
    raise exception 'expected [%] but got [%] for: %', expected, got, q;
  end if;
end $$;

-- me = 我；bob、dan、erin 是我的好友（dan 一局没打过）；carol 不是好友；fay 只发了请求还没通过
insert into auth.users (id, email) values
  ('f0000000-0000-0000-0000-0000000000a1', 'lb_me@lb-test.local'),
  ('f0000000-0000-0000-0000-0000000000b1', 'lb_bob@lb-test.local'),
  ('f0000000-0000-0000-0000-0000000000c1', 'lb_carol@lb-test.local'),
  ('f0000000-0000-0000-0000-0000000000d1', 'lb_dan@lb-test.local'),
  ('f0000000-0000-0000-0000-0000000000e1', 'lb_erin@lb-test.local'),
  ('f0000000-0000-0000-0000-0000000000f1', 'lb_fay@lb-test.local');

insert into public.friendships (requester_id, addressee_id, status) values
  ('f0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-0000000000b1', 'accepted'),
  ('f0000000-0000-0000-0000-0000000000d1', 'f0000000-0000-0000-0000-0000000000a1', 'accepted'),
  ('f0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-0000000000e1', 'accepted'),
  ('f0000000-0000-0000-0000-0000000000f1', 'f0000000-0000-0000-0000-0000000000a1', 'pending'),
  ('f0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-0000000000c1', 'accepted');

-- 井字棋：me 赢 2（一次是对方认输）、输 1、平 1、还在下 1；bob 对 carol 赢 1（好友的战绩只算他自己的）
insert into public.ttt_games (player_x, player_o, status, winner, next_player) values
  ('f0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-0000000000b1', 'x_won', 'f0000000-0000-0000-0000-0000000000a1', null),
  ('f0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-0000000000a1', 'o_won', 'f0000000-0000-0000-0000-0000000000a1', null),
  ('f0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-0000000000b1', 'o_won', 'f0000000-0000-0000-0000-0000000000b1', null),
  ('f0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-0000000000b1', 'draw', null, null),
  ('f0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-0000000000e1', 'resigned', 'f0000000-0000-0000-0000-0000000000a1', null),
  ('f0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-0000000000e1', 'active', null, 'f0000000-0000-0000-0000-0000000000a1'),
  ('f0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-0000000000c1', 'x_won', 'f0000000-0000-0000-0000-0000000000b1', null);

-- 弹弓：me 赢 1 场、输 1 场（认输）；进行中的比分不算；bob 对 carol 赢 1 场
insert into public.sling_games (player_a, player_b, status, winner, score_a, score_b, seed, next_player) values
  ('f0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-0000000000b1', 'a_won', 'f0000000-0000-0000-0000-0000000000a1', 3, 1, 1, null),
  ('f0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-0000000000a1', 'resigned', 'f0000000-0000-0000-0000-0000000000b1', 1, 2, 1, null),
  ('f0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-0000000000b1', 'active', null, 2, 2, 1, 'f0000000-0000-0000-0000-0000000000a1'),
  ('f0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-0000000000c1', 'a_won', 'f0000000-0000-0000-0000-0000000000b1', 3, 0, 1, null);

-- 9球：按盘数算（score_a / score_b 累计，含认输时对方记的那 1 分）
insert into public.pool_games (player_a, player_b, status, winner, score_a, score_b, seed, next_player) values
  ('f0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-0000000000b1', 'rack_over', 'f0000000-0000-0000-0000-0000000000a1', 3, 1, 1, null),
  ('f0000000-0000-0000-0000-0000000000e1', 'f0000000-0000-0000-0000-0000000000a1', 'resigned', 'f0000000-0000-0000-0000-0000000000a1', 0, 1, 1, null),
  ('f0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-0000000000c1', 'active', null, 5, 2, 1, 'f0000000-0000-0000-0000-0000000000b1');

-- 8球：单独一张榜（pool8），盘数同样按 score_a / score_b 算；9球 的榜不能混进这些
insert into public.pool_games (player_a, player_b, status, winner, score_a, score_b, seed, next_player, mode) values
  ('f0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-0000000000b1', 'rack_over', 'f0000000-0000-0000-0000-0000000000a1', 2, 1, 1, null, 'eight'),
  ('f0000000-0000-0000-0000-0000000000b1', 'f0000000-0000-0000-0000-0000000000c1', 'active', null, 0, 3, 1, 'f0000000-0000-0000-0000-0000000000b1', 'eight');

-- 匿名不能调用
call pg_temp.as_anon();
call pg_temp.expect($$select * from public.game_leaderboard('ttt')$$, 'permission denied for function game_leaderboard');

-- 登录后：只接受这几种榜（ttt / sling / pool / pool8）
call pg_temp.as_user('f0000000-0000-0000-0000-0000000000a1');
call pg_temp.expect($$select * from public.game_leaderboard('chess')$$, 'invalid_argument');
call pg_temp.expect($$select * from public.game_leaderboard(null)$$, 'invalid_argument');
call pg_temp.expect($$select * from public.game_leaderboard('pool9')$$, 'invalid_argument');

-- 不带身份（没有 auth.uid()）被拒绝
reset role;
select set_config('request.jwt.claims', '', false);
select set_config('role', 'authenticated', false);
call pg_temp.expect($$select * from public.game_leaderboard('ttt')$$, 'not_authenticated');

call pg_temp.as_user('f0000000-0000-0000-0000-0000000000a1');
do $$
declare n int;
begin
  -- 我 + 3 个好友；carol（非好友）、fay（只是请求）都不能出现
  select count(*) into n from public.game_leaderboard('ttt');
  if n <> 4 then raise exception 'ttt board should have me + 3 friends, got %', n; end if;
  if exists (select 1 from public.game_leaderboard('ttt') where user_id in ('f0000000-0000-0000-0000-0000000000c1', 'f0000000-0000-0000-0000-0000000000f1')) then
    raise exception 'non-friend leaked';
  end if;
end $$;

-- 逐人核对（用 id，不依赖昵称）
create function pg_temp.line(g text) returns text language sql as $$
  select string_agg(case user_id
      when 'f0000000-0000-0000-0000-0000000000a1' then 'me'
      when 'f0000000-0000-0000-0000-0000000000b1' then 'bob'
      when 'f0000000-0000-0000-0000-0000000000d1' then 'dan'
      when 'f0000000-0000-0000-0000-0000000000e1' then 'erin'
      else 'OTHER' end || ':' || wins || '-' || losses, ',')
  from public.game_leaderboard(g)
$$;

do $$
declare got text;
begin
  -- 井字棋：me 赢 3（含 erin 认输）输 1，平局不算；bob 赢 2（1 对 me、1 对 carol）输 2；erin 输 1（认输）；进行中的不算
  got := pg_temp.line('ttt');
  if got <> 'me:3-1,bob:2-2,dan:0-0,erin:0-1' then raise exception 'ttt board wrong: %', got; end if;
  -- 弹弓：me 赢 1 输 1；bob 赢 2（1 对 me、1 对 carol）输 1；进行中的不算；dan、erin 没打过
  got := pg_temp.line('sling');
  if got <> 'bob:2-1,me:1-1,dan:0-0,erin:0-0' then raise exception 'sling board wrong: %', got; end if;
  -- 9球：me 赢 4 盘（3 + 认输的 1）输 1；bob 赢 1 输 3 加上对 carol 的 5 赢 2 输 = 6 胜 5 负；erin 输 1
  got := pg_temp.line('pool');
  if got <> 'bob:6-5,me:4-1,dan:0-0,erin:0-1' then raise exception 'pool board wrong: %', got; end if;
  -- 8球：me 赢 2 输 1；bob 赢 1（对 me）输 2 + 对 carol 输 3 = 1 胜 5 负；9球 的盘数不算在内
  got := pg_temp.line('pool8');
  if got <> 'me:2-1,bob:1-5,dan:0-0,erin:0-0' then raise exception 'pool8 board wrong: %', got; end if;
end $$;

-- 换成 carol 看：只有她自己和 bob；alice 不在她的榜上
call pg_temp.as_user('f0000000-0000-0000-0000-0000000000c1');
do $$
declare got text;
begin
  got := pg_temp.line('ttt');
  if got <> 'bob:2-2,OTHER:0-1' then raise exception 'carol ttt board wrong: %', got; end if;
  if exists (select 1 from public.game_leaderboard('pool') where user_id = 'f0000000-0000-0000-0000-0000000000a1') then
    raise exception 'carol sees non-friend me';
  end if;
end $$;

-- 没有好友的人只有自己，0 胜 0 负
call pg_temp.as_user('f0000000-0000-0000-0000-0000000000f1');
do $$
declare n int; w bigint;
begin
  select count(*), max(wins) into n, w from public.game_leaderboard('sling');
  if n <> 1 or w <> 0 then raise exception 'lonely board wrong'; end if;
end $$;

reset role;
delete from auth.users where email like '%@lb-test.local';
select 'leaderboard tests ok';
