-- 9球台球（pool_games / pool_shots、pool_start / pool_shoot / pool_rematch / pool_resign）的测试
-- 自带数据：开头清理上一次的测试用户，结尾再清理
\set ON_ERROR_STOP on
\set QUIET on

delete from auth.users where email like '%@pool-test.local';

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

insert into auth.users (id, email) values
  ('e0000000-0000-0000-0000-0000000000a1', 'alice@pool-test.local'),
  ('e0000000-0000-0000-0000-0000000000b1', 'bob@pool-test.local'),
  ('e0000000-0000-0000-0000-0000000000c1', 'carol@pool-test.local');

insert into public.friendships (requester_id, addressee_id, status) values
  ('e0000000-0000-0000-0000-0000000000a1', 'e0000000-0000-0000-0000-0000000000b1', 'accepted');

-- 常用的合法结果：白球还在（没犯规）/ 白球拿起来（犯规）
-- 参数顺序：局, 回合, dx, dy, 力度, 白球x, 白球y, 结果, 落袋, 犯规, 赢, 继续

-- 匿名不能调用
call pg_temp.as_anon();
call pg_temp.expect($$select public.pool_start('e0000000-0000-0000-0000-0000000000b1')$$, 'permission denied for function pool_start');
call pg_temp.expect($$select public.pool_shoot(1, 1, 0, -1, 0.5, null, null, '{"b":[]}'::jsonb, '{}', null, false, false)$$, 'permission denied for function pool_shoot');
call pg_temp.expect($$select public.pool_rematch(1)$$, 'permission denied for function pool_rematch');
call pg_temp.expect($$select public.pool_resign(1)$$, 'permission denied for function pool_resign');

-- 没有写策略
call pg_temp.as_user('e0000000-0000-0000-0000-0000000000a1');
call pg_temp.expect($$insert into public.pool_games (player_a, player_b, seed) values ('e0000000-0000-0000-0000-0000000000a1', 'e0000000-0000-0000-0000-0000000000b1', 1)$$, 'permission denied for table pool_games');
call pg_temp.expect($$update public.pool_games set score_a = 3$$, 'permission denied for table pool_games');
call pg_temp.expect($$insert into public.pool_shots (game_id, shooter, turn_no, rack_no, seed, dx, dy, power, result) values (1, 'e0000000-0000-0000-0000-0000000000a1', 1, 1, 1, 0, -1, 1, '{}')$$, 'permission denied for table pool_shots');

-- 只能和好友玩
call pg_temp.expect($$select public.pool_start('e0000000-0000-0000-0000-0000000000c1')$$, 'not_friends');
call pg_temp.expect($$select public.pool_start('e0000000-0000-0000-0000-0000000000a1')$$, 'not_friends');
call pg_temp.expect($$select public.pool_start(null)$$, 'not_friends');

-- 开局：alice 为 A 先开球；有种子；聊天里多一条消息；重复开返回同一局
do $$
declare g public.pool_games; g2 public.pool_games; m public.messages;
begin
  g := public.pool_start('e0000000-0000-0000-0000-0000000000b1');
  if g.player_a <> 'e0000000-0000-0000-0000-0000000000a1' or g.player_b <> 'e0000000-0000-0000-0000-0000000000b1' then raise exception 'caller must be A'; end if;
  if g.next_player <> g.player_a then raise exception 'A must break first'; end if;
  if g.status <> 'active' or g.score_a <> 0 or g.score_b <> 0 or g.rack_no <> 1 or g.turn_no <> 1 or g.state is not null or g.in_hand then raise exception 'new game wrong'; end if;
  if g.seed is null or g.seed < 1 then raise exception 'seed wrong'; end if;
  select * into m from public.messages where id = g.message_id;
  if m.body <> '[9球台球]#' || g.id or m.sender_id <> g.player_a or m.receiver_id <> g.player_b then raise exception 'invite message wrong: %', m.body; end if;
  g2 := public.pool_start('e0000000-0000-0000-0000-0000000000b1');
  if g2.id <> g.id then raise exception 'active game should be reused'; end if;
  if (select count(*) from public.pool_games) <> 1 then raise exception 'duplicate game'; end if;
  if (select count(*) from public.messages where body like '[9球台球]#%') <> 1 then raise exception 'duplicate message'; end if;
end $$;
call pg_temp.as_user('e0000000-0000-0000-0000-0000000000b1');
do $$ begin
  if (public.pool_start('e0000000-0000-0000-0000-0000000000a1')).player_a <> 'e0000000-0000-0000-0000-0000000000a1' then raise exception 'peer should reuse game'; end if;
end $$;

-- 匿名和旁人看不到、也动不了
call pg_temp.as_anon();
do $$ begin
  if (select count(*) from public.pool_games) <> 0 then raise exception 'anon sees games'; end if;
  if (select count(*) from public.pool_shots) <> 0 then raise exception 'anon sees shots'; end if;
end $$;
call pg_temp.as_user('e0000000-0000-0000-0000-0000000000c1');
do $$
declare gid bigint;
begin
  if (select count(*) from public.pool_games) <> 0 then raise exception 'non-player sees game'; end if;
  reset role;
  select id into gid from public.pool_games;
  call pg_temp.as_user('e0000000-0000-0000-0000-0000000000c1');
  begin perform public.pool_shoot(gid, 1, 0, -1, 0.5, null, null, '{"b":[[0,170,300]]}'::jsonb, '{}', null, false, false); raise exception 'non-player shoot should fail';
  exception when others then if sqlerrm <> 'game_not_found' then raise; end if; end;
  begin perform public.pool_resign(gid); raise exception 'non-player resign should fail';
  exception when others then if sqlerrm <> 'game_not_found' then raise; end if; end;
  begin perform public.pool_rematch(gid); raise exception 'non-player rematch should fail';
  exception when others then if sqlerrm <> 'game_not_found' then raise; end if; end;
end $$;

-- 轮次、过期回合、参数校验
call pg_temp.as_user('e0000000-0000-0000-0000-0000000000b1');
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 1, 0, -1, 0.5, null, null, '{"b":[[0,170,300]]}'::jsonb, '{}', null, false, false)$$, 'not_your_turn');
call pg_temp.as_user('e0000000-0000-0000-0000-0000000000a1');
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 2, 0, -1, 0.5, null, null, '{"b":[[0,170,300]]}'::jsonb, '{}', null, false, false)$$, 'stale_turn');
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), null, 0, -1, 0.5, null, null, '{"b":[[0,170,300]]}'::jsonb, '{}', null, false, false)$$, 'stale_turn');
-- 方向必须是单位向量、力度 0.02..1
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 1, 1, 1, 0.5, null, null, '{"b":[[0,170,300]]}'::jsonb, '{}', null, false, false)$$, 'invalid_shot');
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 1, null, -1, 0.5, null, null, '{"b":[[0,170,300]]}'::jsonb, '{}', null, false, false)$$, 'invalid_shot');
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 1, 0, -1, 0.01, null, null, '{"b":[[0,170,300]]}'::jsonb, '{}', null, false, false)$$, 'invalid_shot');
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 1, 0, -1, 1.01, null, null, '{"b":[[0,170,300]]}'::jsonb, '{}', null, false, false)$$, 'invalid_shot');
-- 判定字段要自洽
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 1, 0, -1, 0.5, null, null, '{"b":[[0,170,300]]}'::jsonb, '{}', 'rail', false, true)$$, 'invalid_shot'); -- 犯规不能继续
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 1, 0, -1, 0.5, null, null, '{"b":[[0,170,300]]}'::jsonb, '{9}', null, true, true)$$, 'invalid_shot'); -- 赢和继续互斥
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 1, 0, -1, 0.5, null, null, '{"b":[[0,170,300]]}'::jsonb, '{}', null, true, false)$$, 'invalid_shot'); -- 赢必须 9 号落袋
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 1, 0, -1, 0.5, null, null, '{"b":[[0,170,300]]}'::jsonb, '{}', null, false, true)$$, 'invalid_shot'); -- 继续必须有球进袋
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 1, 0, -1, 0.5, null, null, '{"b":[[1,170,300]]}'::jsonb, '{}', null, false, false)$$, 'invalid_shot'); -- 没犯规白球必须在
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 1, 0, -1, 0.5, null, null, '{"b":[[0,170,300]]}'::jsonb, '{}', 'rail', false, false)$$, 'invalid_shot'); -- 犯规白球必须拿起来
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 1, 0, -1, 0.5, null, null, '{"b":[[0,170,300]]}'::jsonb, '{0}', null, false, false)$$, 'invalid_shot'); -- 白球落袋必须算犯规
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 1, 0, -1, 0.5, null, null, '{"b":[]}'::jsonb, '{0}', 'wrong', false, false)$$, 'invalid_shot'); -- 白球落袋必须是母球落袋
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 1, 0, -1, 0.5, null, null, '{"b":[[0,170,300]]}'::jsonb, '{2,2}', null, false, false)$$, 'invalid_shot');
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 1, 0, -1, 0.5, null, null, '{"b":[[0,170,300]]}'::jsonb, '{10}', null, false, false)$$, 'invalid_shot');
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 1, 0, -1, 0.5, null, null, '{"b":[[0,170,300]]}'::jsonb, null, null, false, false)$$, 'invalid_shot');
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 1, 0, -1, 0.5, null, null, '{"b":[[0,170,300]]}'::jsonb, '{}', 'bogus', false, false)$$, 'invalid_shot');
-- 台面格式和范围
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 1, 0, -1, 0.5, null, null, null, '{}', null, false, false)$$, 'invalid_shot');
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 1, 0, -1, 0.5, null, null, '[1]'::jsonb, '{}', null, false, false)$$, 'invalid_shot');
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 1, 0, -1, 0.5, null, null, '{"b":"x"}'::jsonb, '{}', null, false, false)$$, 'invalid_shot');
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 1, 0, -1, 0.5, null, null, '{"b":[[0,170]]}'::jsonb, '{}', null, false, false)$$, 'invalid_shot');
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 1, 0, -1, 0.5, null, null, '{"b":[[0,"a",300]]}'::jsonb, '{}', null, false, false)$$, 'invalid_shot');
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 1, 0, -1, 0.5, null, null, '{"b":[[0,400,300]]}'::jsonb, '{}', null, false, false)$$, 'invalid_shot'); -- 出界
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 1, 0, -1, 0.5, null, null, '{"b":[[0,170,300],[0,100,100]]}'::jsonb, '{}', null, false, false)$$, 'invalid_shot'); -- 两个白球
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 1, 0, -1, 0.5, null, null, '{"b":[[0,170,300],[1,100,100],[1,120,120]]}'::jsonb, '{}', null, false, false)$$, 'invalid_shot'); -- 重复的球
-- 开球时不能给白球位置（不是自由球）
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 1, 0, -1, 0.5, 170, 450, '{"b":[[0,170,300]]}'::jsonb, '{}', null, false, false)$$, 'invalid_cue');
do $$ begin
  if (select count(*) from public.pool_shots) <> 0 then raise exception 'rejected shots must not be recorded'; end if;
end $$;

-- 开球：没有进球、没犯规，轮到 bob；存下台面、方向、力度；同一回合不能重复提交
do $$
declare gid bigint; g public.pool_games; r jsonb; s0 int;
begin
  select id, seed into gid, s0 from public.pool_games;
  r := public.pool_shoot(gid, 1, 0.000001, -0.999999999999, 0.874, null, null, '{"b":[[0,170,300],[1,170,170],[2,100,100],[9,200,150]]}'::jsonb, '{}', null, false, false);
  g := jsonb_populate_record(null::public.pool_games, r -> 'game');
  if g.turn_no <> 2 or g.next_player <> 'e0000000-0000-0000-0000-0000000000b1' or g.status <> 'active' or g.in_hand or g.last_foul is not null or g.seed <> s0 or g.rack_no <> 1 then raise exception 'break wrong'; end if;
  if g.state is null or jsonb_array_length(g.state -> 'b') <> 4 then raise exception 'state not stored'; end if;
  if (select count(*) from public.pool_shots where id = (r ->> 'shot_id')::bigint and shooter = 'e0000000-0000-0000-0000-0000000000a1' and turn_no = 1 and pre is null and power = 0.874 and not keep and not won and foul is null) <> 1 then raise exception 'shot not recorded'; end if;
  begin perform public.pool_shoot(gid, 1, 0, -1, 0.5, null, null, '{"b":[[0,170,300]]}'::jsonb, '{}', null, false, false); raise exception 'double submit should fail';
  exception when others then if sqlerrm <> 'not_your_turn' then raise; end if; end;
end $$;
-- 对手也看得到出杆记录
call pg_temp.as_user('e0000000-0000-0000-0000-0000000000b1');
do $$ begin
  if (select count(*) from public.pool_shots) <> 1 then raise exception 'peer cannot see shots'; end if;
end $$;

-- bob 合法进球 → 继续出杆（还是他）
do $$
declare gid bigint; g public.pool_games; r jsonb;
begin
  select id into gid from public.pool_games;
  r := public.pool_shoot(gid, 2, 0, -1, 0.5, null, null, '{"b":[[0,170,300],[2,100,100],[9,200,150]]}'::jsonb, '{1}', null, false, true);
  g := jsonb_populate_record(null::public.pool_games, r -> 'game');
  if g.next_player <> 'e0000000-0000-0000-0000-0000000000b1' or g.turn_no <> 3 or g.in_hand then raise exception 'keep wrong'; end if;
  -- 这一杆存下的 pre 就是上一杆的结果
  if (select pre -> 'b' -> 1 ->> 0 from public.pool_shots where id = (r ->> 'shot_id')::bigint) <> '1' then raise exception 'pre not stored'; end if;
  if (select count(*) from public.pool_shots where id = (r ->> 'shot_id')::bigint and keep and potted = '{1}') <> 1 then raise exception 'keep not recorded'; end if;
end $$;

-- bob 犯规（母球落袋，同时进了 2 号）→ 轮到 alice，自由球
do $$
declare gid bigint; g public.pool_games; r jsonb;
begin
  select id into gid from public.pool_games;
  r := public.pool_shoot(gid, 3, 0, -1, 0.9, null, null, '{"b":[[9,200,150]]}'::jsonb, '{0,2}', 'scratch', false, false);
  g := jsonb_populate_record(null::public.pool_games, r -> 'game');
  if g.next_player <> 'e0000000-0000-0000-0000-0000000000a1' or not g.in_hand or g.last_foul <> 'scratch' or g.turn_no <> 4 then raise exception 'foul wrong'; end if;
end $$;

-- 自由球：alice 必须给出白球位置；不能压住别的球、不能出界；位置要存下来
call pg_temp.as_user('e0000000-0000-0000-0000-0000000000a1');
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 4, 0, -1, 0.5, null, null, '{"b":[[0,170,300],[9,200,150]]}'::jsonb, '{}', null, false, false)$$, 'invalid_cue');
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 4, 0, -1, 0.5, 200, null, '{"b":[[0,170,300],[9,200,150]]}'::jsonb, '{}', null, false, false)$$, 'invalid_cue');
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 4, 0, -1, 0.5, 205, 160, '{"b":[[0,170,300],[9,200,150]]}'::jsonb, '{}', null, false, false)$$, 'invalid_cue'); -- 压住 9 号
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 4, 0, -1, 0.5, -5, 300, '{"b":[[0,170,300],[9,200,150]]}'::jsonb, '{}', null, false, false)$$, 'invalid_cue');
call pg_temp.expect($$select public.pool_shoot((select id from public.pool_games), 4, 0, -1, 0.5, 100, 700, '{"b":[[0,170,300],[9,200,150]]}'::jsonb, '{}', null, false, false)$$, 'invalid_cue');
do $$
declare gid bigint; g public.pool_games; r jsonb;
begin
  select id into gid from public.pool_games;
  -- 紧贴 9 号球但不重叠，合法；没有进球、没碰库也没犯规是不可能的，这里直接按"合法、无进球"提交
  r := public.pool_shoot(gid, 4, 0.6, -0.8, 0.5, 200, 171.5, '{"b":[[0,50,50],[9,200,150]]}'::jsonb, '{}', null, false, false);
  g := jsonb_populate_record(null::public.pool_games, r -> 'game');
  if g.in_hand or g.last_foul is not null or g.next_player <> 'e0000000-0000-0000-0000-0000000000b1' or g.turn_no <> 5 then raise exception 'ball-in-hand shot wrong'; end if;
  if (select count(*) from public.pool_shots where id = (r ->> 'shot_id')::bigint and cue_x = 200 and cue_y = 171.5 and pre is not null) <> 1 then raise exception 'cue position not recorded'; end if;
end $$;

-- 赢：bob 合法打进 9 号 → 这盘结束，bob 记一分，没有下一手；之后不能再出杆
call pg_temp.as_user('e0000000-0000-0000-0000-0000000000b1');
do $$
declare gid bigint; g public.pool_games; r jsonb;
begin
  select id into gid from public.pool_games;
  r := public.pool_shoot(gid, 5, 0, -1, 0.7, null, null, '{"b":[[0,60,60]]}'::jsonb, '{9}', null, true, false);
  g := jsonb_populate_record(null::public.pool_games, r -> 'game');
  if g.status <> 'rack_over' or g.winner <> 'e0000000-0000-0000-0000-0000000000b1' or g.next_player is not null or g.score_b <> 1 or g.score_a <> 0 then raise exception 'win wrong: % % % %', g.status, g.winner, g.score_a, g.score_b; end if;
  if (select count(*) from public.pool_shots where id = (r ->> 'shot_id')::bigint and won) <> 1 then raise exception 'win not recorded'; end if;
  begin perform public.pool_shoot(gid, 6, 0, -1, 0.5, null, null, '{"b":[[0,170,300]]}'::jsonb, '{}', null, false, false); raise exception 'shoot after rack over should fail';
  exception when others then if sqlerrm <> 'game_over' then raise; end if; end;
  begin perform public.pool_resign(gid); raise exception 'resign after rack over should fail';
  exception when others then if sqlerrm <> 'game_over' then raise; end if; end;
end $$;

-- 再来一盘：比分保留，第 2 盘由 bob（B）开球，新的种子，台面清空；已经开了再点就返回同一盘
do $$
declare gid bigint; g public.pool_games; s0 int; g2 public.pool_games;
begin
  select id, seed into gid, s0 from public.pool_games;
  call pg_temp.as_user('e0000000-0000-0000-0000-0000000000a1');
  g := public.pool_rematch(gid);
  if g.status <> 'active' or g.rack_no <> 2 or g.score_a <> 0 or g.score_b <> 1 or g.winner is not null then raise exception 'rematch wrong'; end if;
  if g.next_player <> 'e0000000-0000-0000-0000-0000000000b1' or g.state is not null or g.in_hand or g.last_foul is not null or g.turn_no <> 7 then raise exception 'rematch state wrong'; end if;
  if g.seed = s0 then raise exception 'seed should change'; end if;
  call pg_temp.as_user('e0000000-0000-0000-0000-0000000000b1');
  g2 := public.pool_rematch(gid);
  if g2.rack_no <> 2 or g2.turn_no <> g.turn_no then raise exception 'second rematch should be a no-op'; end if;
  -- 开球的是 bob；alice 不能抢先
  call pg_temp.as_user('e0000000-0000-0000-0000-0000000000a1');
  begin perform public.pool_shoot(gid, g.turn_no, 0, -1, 0.5, null, null, '{"b":[[0,170,300]]}'::jsonb, '{}', null, false, false); raise exception 'alice must wait for the break';
  exception when others then if sqlerrm <> 'not_your_turn' then raise; end if; end;
end $$;

-- 认输：对方记一分；不在自己回合也能认输；之后可以再来一盘（第 3 盘由 alice 开球）
do $$
declare gid bigint; g public.pool_games;
begin
  select id into gid from public.pool_games;
  call pg_temp.as_user('e0000000-0000-0000-0000-0000000000a1');
  g := public.pool_resign(gid);
  if g.status <> 'resigned' or g.winner <> 'e0000000-0000-0000-0000-0000000000b1' or g.next_player is not null or g.score_b <> 2 or g.score_a <> 0 then raise exception 'resign wrong'; end if;
  call pg_temp.as_user('e0000000-0000-0000-0000-0000000000b1');
  begin perform public.pool_shoot(gid, g.turn_no, 0, -1, 0.5, null, null, '{"b":[[0,170,300]]}'::jsonb, '{}', null, false, false); raise exception 'shoot after resign should fail';
  exception when others then if sqlerrm <> 'game_over' then raise; end if; end;
  g := public.pool_rematch(gid);
  if g.status <> 'active' or g.rack_no <> 3 or g.next_player <> 'e0000000-0000-0000-0000-0000000000a1' or g.score_b <> 2 then raise exception 'rematch after resign wrong'; end if;
end $$;

-- 结束的局之后再 pool_start：新开一局，比分归零，聊天里多一条新消息
do $$
declare gid bigint; g public.pool_games;
begin
  select id into gid from public.pool_games;
  call pg_temp.as_user('e0000000-0000-0000-0000-0000000000b1');
  g := public.pool_resign(gid);
  g := public.pool_start('e0000000-0000-0000-0000-0000000000a1');
  if g.id = gid or g.player_a <> 'e0000000-0000-0000-0000-0000000000b1' or g.score_a <> 0 or g.score_b <> 0 or g.rack_no <> 1 then raise exception 'new game after a finished one wrong'; end if;
  if (select count(*) from public.messages where body like '[9球台球]#%') <> 2 then raise exception 'second invite message missing'; end if;
end $$;

reset role;
delete from auth.users where email like '%@pool-test.local';
select 'nineball tests ok';
