-- 弹弓大战（sling_games / sling_shots、sling_start / sling_shoot / sling_resign）的测试
-- 自带数据：开头清理上一次的测试用户，结尾再清理
\set ON_ERROR_STOP on
\set QUIET on

delete from auth.users where email like '%@sling-test.local';

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
  ('f0000000-0000-0000-0000-0000000000a1', 'alice@sling-test.local'),
  ('f0000000-0000-0000-0000-0000000000b1', 'bob@sling-test.local'),
  ('f0000000-0000-0000-0000-0000000000c1', 'carol@sling-test.local');

insert into public.friendships (requester_id, addressee_id, status) values
  ('f0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-0000000000b1', 'accepted');

-- 匿名不能调用
call pg_temp.as_anon();
call pg_temp.expect($$select public.sling_start('f0000000-0000-0000-0000-0000000000b1')$$, 'permission denied for function sling_start');
call pg_temp.expect($$select public.sling_shoot(1, 1, 'carrot', 30, 0.5, '{}'::jsonb, false)$$, 'permission denied for function sling_shoot');
call pg_temp.expect($$select public.sling_resign(1)$$, 'permission denied for function sling_resign');

-- 没有写策略
call pg_temp.as_user('f0000000-0000-0000-0000-0000000000a1');
call pg_temp.expect($$insert into public.sling_games (player_a, player_b, seed) values ('f0000000-0000-0000-0000-0000000000a1', 'f0000000-0000-0000-0000-0000000000b1', 1)$$, 'permission denied for table sling_games');
call pg_temp.expect($$update public.sling_games set score_a = 3$$, 'permission denied for table sling_games');
call pg_temp.expect($$insert into public.sling_shots (game_id, shooter, turn_no, round_no, seed, ammo, angle, power, wind, result) values (1, 'f0000000-0000-0000-0000-0000000000a1', 1, 1, 1, 'carrot', 1, 1, 0, '{}')$$, 'permission denied for table sling_shots');

-- 只能和好友玩
call pg_temp.expect($$select public.sling_start('f0000000-0000-0000-0000-0000000000c1')$$, 'not_friends');
call pg_temp.expect($$select public.sling_start('f0000000-0000-0000-0000-0000000000a1')$$, 'not_friends');
call pg_temp.expect($$select public.sling_start(null)$$, 'not_friends');

-- 开局：alice 为 A 先手；有种子和风；聊天里多一条消息；重复开返回同一局
do $$
declare g public.sling_games; g2 public.sling_games; m public.messages;
begin
  g := public.sling_start('f0000000-0000-0000-0000-0000000000b1');
  if g.player_a <> 'f0000000-0000-0000-0000-0000000000a1' or g.player_b <> 'f0000000-0000-0000-0000-0000000000b1' then raise exception 'caller must be A'; end if;
  if g.next_player <> g.player_a then raise exception 'A must move first'; end if;
  if g.status <> 'active' or g.score_a <> 0 or g.score_b <> 0 or g.round_no <> 1 or g.turn_no <> 1 or g.state is not null then raise exception 'new game wrong'; end if;
  if g.seed is null or g.seed < 1 or g.wind < -1 or g.wind > 1 then raise exception 'seed/wind wrong'; end if;
  select * into m from public.messages where id = g.message_id;
  if m.body <> '[弹弓大战]#' || g.id or m.sender_id <> g.player_a or m.receiver_id <> g.player_b then raise exception 'invite message wrong: %', m.body; end if;
  g2 := public.sling_start('f0000000-0000-0000-0000-0000000000b1');
  if g2.id <> g.id then raise exception 'active game should be reused'; end if;
  if (select count(*) from public.sling_games) <> 1 then raise exception 'duplicate game'; end if;
  if (select count(*) from public.messages where body like '[弹弓大战]#%') <> 1 then raise exception 'duplicate message'; end if;
end $$;
call pg_temp.as_user('f0000000-0000-0000-0000-0000000000b1');
do $$ begin
  if (public.sling_start('f0000000-0000-0000-0000-0000000000a1')).player_a <> 'f0000000-0000-0000-0000-0000000000a1' then raise exception 'peer should reuse game'; end if;
end $$;

-- 匿名和旁人看不到、也动不了
call pg_temp.as_anon();
do $$ begin
  if (select count(*) from public.sling_games) <> 0 then raise exception 'anon sees games'; end if;
  if (select count(*) from public.sling_shots) <> 0 then raise exception 'anon sees shots'; end if;
end $$;
call pg_temp.as_user('f0000000-0000-0000-0000-0000000000c1');
do $$
declare gid bigint;
begin
  if (select count(*) from public.sling_games) <> 0 then raise exception 'non-player sees game'; end if;
  select id into gid from public.sling_games; -- RLS 之外读不到
  reset role;
  select id into gid from public.sling_games;
  call pg_temp.as_user('f0000000-0000-0000-0000-0000000000c1');
  begin perform public.sling_shoot(gid, 1, 'carrot', 30, 0.5, '{}'::jsonb, false); raise exception 'non-player shoot should fail';
  exception when others then if sqlerrm <> 'game_not_found' then raise; end if; end;
  begin perform public.sling_resign(gid); raise exception 'non-player resign should fail';
  exception when others then if sqlerrm <> 'game_not_found' then raise; end if; end;
end $$;

-- 轮次、过期回合、参数校验、结果大小
call pg_temp.as_user('f0000000-0000-0000-0000-0000000000b1');
call pg_temp.expect($$select public.sling_shoot((select id from public.sling_games), 1, 'carrot', 30, 0.5, '{}'::jsonb, false)$$, 'not_your_turn');
call pg_temp.as_user('f0000000-0000-0000-0000-0000000000a1');
call pg_temp.expect($$select public.sling_shoot((select id from public.sling_games), 2, 'carrot', 30, 0.5, '{}'::jsonb, false)$$, 'stale_turn');
call pg_temp.expect($$select public.sling_shoot((select id from public.sling_games), 0, 'carrot', 30, 0.5, '{}'::jsonb, false)$$, 'stale_turn');
call pg_temp.expect($$select public.sling_shoot((select id from public.sling_games), null, 'carrot', 30, 0.5, '{}'::jsonb, false)$$, 'stale_turn');
call pg_temp.expect($$select public.sling_shoot((select id from public.sling_games), 1, 'rock', 30, 0.5, '{}'::jsonb, false)$$, 'invalid_ammo');
call pg_temp.expect($$select public.sling_shoot((select id from public.sling_games), 1, null, 30, 0.5, '{}'::jsonb, false)$$, 'invalid_ammo');
call pg_temp.expect($$select public.sling_shoot((select id from public.sling_games), 1, 'carrot', 91, 0.5, '{}'::jsonb, false)$$, 'invalid_shot');
call pg_temp.expect($$select public.sling_shoot((select id from public.sling_games), 1, 'carrot', -46, 0.5, '{}'::jsonb, false)$$, 'invalid_shot');
call pg_temp.expect($$select public.sling_shoot((select id from public.sling_games), 1, 'carrot', null, 0.5, '{}'::jsonb, false)$$, 'invalid_shot');
call pg_temp.expect($$select public.sling_shoot((select id from public.sling_games), 1, 'carrot', 30, 0, '{}'::jsonb, false)$$, 'invalid_shot');
call pg_temp.expect($$select public.sling_shoot((select id from public.sling_games), 1, 'carrot', 30, 1.01, '{}'::jsonb, false)$$, 'invalid_shot');
call pg_temp.expect($$select public.sling_shoot((select id from public.sling_games), 1, 'carrot', 30, 0.5, null, false)$$, 'invalid_shot');
call pg_temp.expect($$select public.sling_shoot((select id from public.sling_games), 1, 'carrot', 30, 0.5, '[1]'::jsonb, false)$$, 'invalid_shot');
call pg_temp.expect($$select public.sling_shoot((select id from public.sling_games), 1, 'carrot', 30, 0.5, '{}'::jsonb, null)$$, 'invalid_shot');
call pg_temp.expect($$select public.sling_shoot((select id from public.sling_games), 1, 'carrot', 30, 0.5, jsonb_build_object('x', repeat('a', 17000)), false)$$, 'invalid_shot');
do $$ begin
  if (select count(*) from public.sling_shots) <> 0 then raise exception 'rejected shots must not be recorded'; end if;
end $$;

-- 正常出手：状态存下来，换人，新风，回合 +1；同一回合不能重复提交
do $$
declare gid bigint; g public.sling_games; r jsonb; w0 numeric; s0 int;
begin
  select id, wind, seed into gid, w0, s0 from public.sling_games;
  r := public.sling_shoot(gid, 1, 'snowball', 45.5, 0.8, '{"b":[[1,2,0,100,0,0]],"v":[[0,0,0],[0,0,0]]}'::jsonb, false);
  g := jsonb_populate_record(null::public.sling_games, r -> 'game');
  if g.turn_no <> 2 or g.next_player <> 'f0000000-0000-0000-0000-0000000000b1' or g.score_a <> 0 or g.round_no <> 1 or g.seed <> s0 then raise exception 'shot 1 wrong'; end if;
  if g.state is null or (g.state -> 'b' -> 0 ->> 3) <> '100' then raise exception 'state not stored'; end if;
  if (select count(*) from public.sling_shots where id = (r ->> 'shot_id')::bigint and shooter = 'f0000000-0000-0000-0000-0000000000a1' and turn_no = 1 and ammo = 'snowball' and wind = w0 and not knocked) <> 1 then raise exception 'shot not recorded'; end if;
  begin perform public.sling_shoot(gid, 1, 'carrot', 30, 0.5, '{}'::jsonb, false); raise exception 'double submit should fail';
  exception when others then if sqlerrm <> 'not_your_turn' then raise; end if; end;
end $$;
-- 对手也看得到出手记录
call pg_temp.as_user('f0000000-0000-0000-0000-0000000000b1');
do $$ begin
  if (select count(*) from public.sling_shots) <> 1 then raise exception 'peer cannot see shots'; end if;
end $$;

-- 风：每一发都在 [-1, 1]，并且会变（20 发里至少变过几次）
do $$
declare gid bigint; g public.sling_games; i int; changed int := 0; prev numeric; me uuid;
begin
  select id into gid from public.sling_games;
  select * into g from public.sling_games where id = gid;
  prev := g.wind;
  for i in 1..20 loop
    me := (select next_player from public.sling_games where id = gid);
    call pg_temp.as_user(me);
    g := jsonb_populate_record(null::public.sling_games, public.sling_shoot(gid, (select turn_no from public.sling_games where id = gid), 'carrot', 30, 0.5, '{"v":1}'::jsonb, false) -> 'game');
    if g.wind < -1 or g.wind > 1 then raise exception 'wind out of range: %', g.wind; end if;
    if g.wind <> prev then changed := changed + 1; end if;
    prev := g.wind;
  end loop;
  if changed < 10 then raise exception 'wind barely changes (%)', changed; end if;
  if (select count(*) from public.sling_shots where game_id = gid and wind between -1 and 1) <> 21 then raise exception 'shots wind wrong'; end if;
end $$;

-- 得分与胜负：alice 连中三次（bob 每次都没中）
do $$
declare gid bigint; g public.sling_games; r jsonb; me uuid; s0 int; k int; ra int;
begin
  select id into gid from public.sling_games;
  -- 轮到谁就让谁先打，直到轮到 alice
  select next_player into me from public.sling_games where id = gid;
  if me <> 'f0000000-0000-0000-0000-0000000000a1' then
    call pg_temp.as_user(me);
    perform public.sling_shoot(gid, (select turn_no from public.sling_games where id = gid), 'chili', 10, 0.3, '{"v":2}'::jsonb, false);
  end if;
  for k in 1..3 loop
    call pg_temp.as_user('f0000000-0000-0000-0000-0000000000a1');
    select seed, round_no into s0, ra from public.sling_games where id = gid;
    r := public.sling_shoot(gid, (select turn_no from public.sling_games where id = gid), 'carrot', 40, 0.9, '{"hit":true}'::jsonb, true);
    g := jsonb_populate_record(null::public.sling_games, r -> 'game');
    if g.score_a <> k or g.score_b <> 0 then raise exception 'score wrong at %: %:%', k, g.score_a, g.score_b; end if;
    if g.round_no <> ra + 1 then raise exception 'round_no should advance'; end if;
    if g.seed = s0 then raise exception 'seed should change on a new round'; end if;
    if g.state is not null then raise exception 'state should reset on a new round'; end if;
    if (select knocked from public.sling_shots where id = (r ->> 'shot_id')::bigint) is not true then raise exception 'knocked not recorded'; end if;
    if k < 3 then
      if g.status <> 'active' or g.winner is not null or g.next_player <> g.player_b then raise exception 'round % state wrong: % %', k, g.status, g.next_player; end if;
      call pg_temp.as_user('f0000000-0000-0000-0000-0000000000b1');
      perform public.sling_shoot(gid, g.turn_no, 'carrot', 20, 0.4, '{"miss":true}'::jsonb, false);
    else
      if g.status <> 'a_won' or g.winner <> g.player_a or g.next_player is not null then raise exception 'win at 3 wrong: % %', g.status, g.winner; end if;
    end if;
  end loop;
  begin perform public.sling_shoot(gid, g.turn_no, 'carrot', 30, 0.5, '{}'::jsonb, false); raise exception 'shoot after win should fail';
  exception when others then if sqlerrm <> 'game_over' then raise; end if; end;
  begin perform public.sling_resign(gid); raise exception 'resign after win should fail';
  exception when others then if sqlerrm <> 'game_over' then raise; end if; end;
end $$;

-- 再来一局：新建；bob 发起时 bob 是 A 且先手；B 方击中得分，B 方赢
do $$
declare g public.sling_games; gid bigint; k int; ok boolean;
begin
  call pg_temp.as_user('f0000000-0000-0000-0000-0000000000b1');
  g := public.sling_start('f0000000-0000-0000-0000-0000000000a1');
  if g.player_a <> 'f0000000-0000-0000-0000-0000000000b1' or g.next_player <> g.player_a or g.score_a <> 0 or g.status <> 'active' then raise exception 'rematch wrong'; end if;
  gid := g.id;
  -- bob 先手 miss，alice（B 方）连中三次
  perform public.sling_shoot(gid, 1, 'carrot', 30, 0.5, '{}'::jsonb, false);
  for k in 1..3 loop
    call pg_temp.as_user('f0000000-0000-0000-0000-0000000000a1');
    g := jsonb_populate_record(null::public.sling_games, public.sling_shoot(gid, (select turn_no from public.sling_games where id = gid), 'chili', 30, 0.5, '{}'::jsonb, true) -> 'game');
    if g.score_b <> k or g.score_a <> 0 then raise exception 'B score wrong'; end if;
    if k < 3 then
      call pg_temp.as_user('f0000000-0000-0000-0000-0000000000b1');
      perform public.sling_shoot(gid, g.turn_no, 'carrot', 30, 0.5, '{}'::jsonb, false);
    end if;
  end loop;
  if g.status <> 'b_won' or g.winner <> 'f0000000-0000-0000-0000-0000000000a1' then raise exception 'B win wrong'; end if;
end $$;

-- 认输：对方获胜；之后不能出手
do $$
declare g public.sling_games; gid bigint;
begin
  call pg_temp.as_user('f0000000-0000-0000-0000-0000000000a1');
  g := public.sling_start('f0000000-0000-0000-0000-0000000000b1');
  gid := g.id;
  -- 不在自己回合也能认输
  call pg_temp.as_user('f0000000-0000-0000-0000-0000000000b1');
  g := public.sling_resign(gid);
  if g.status <> 'resigned' or g.winner <> 'f0000000-0000-0000-0000-0000000000a1' or g.next_player is not null then raise exception 'resign wrong'; end if;
  call pg_temp.as_user('f0000000-0000-0000-0000-0000000000a1');
  begin perform public.sling_shoot(gid, g.turn_no, 'carrot', 30, 0.5, '{}'::jsonb, false); raise exception 'shoot after resign should fail';
  exception when others then if sqlerrm <> 'game_over' then raise; end if; end;
end $$;

reset role;
delete from auth.users where email like '%@sling-test.local';
select 'slingshot tests ok';
