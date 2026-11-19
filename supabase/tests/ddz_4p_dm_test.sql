-- 斗地主升级（四人局 + 私聊桌）：4 个座位 / 私聊开桌要好友 / 非好友看不到 / 一对好友一张桌 / 私聊里入座离座机器人 / 积分按群或按好友对累计 / 好友关系结束时关桌 / 旧的群积分行仍然有效，CI 在临时 Postgres 上运行
\set ON_ERROR_STOP on
\set QUIET on

delete from auth.users where email like '%@ddz4-test.local';

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

create procedure pg_temp.as_admin() language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);
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
  ('d8000000-0000-0000-0000-00000000000a', 'z_alice@ddz4-test.local'),
  ('d8000000-0000-0000-0000-00000000000b', 'z_bob@ddz4-test.local'),
  ('d8000000-0000-0000-0000-00000000000c', 'z_carol@ddz4-test.local'),
  ('d8000000-0000-0000-0000-00000000000d', 'z_dave@ddz4-test.local'),
  ('d8000000-0000-0000-0000-00000000000e', 'z_eve@ddz4-test.local');

-- alice 和 bob、carol、dave 都是好友（bob、carol、dave 之间不是好友）；eve 谁也不认识
insert into public.friendships (requester_id, addressee_id, status) values
  ('d8000000-0000-0000-0000-00000000000a', 'd8000000-0000-0000-0000-00000000000b', 'accepted'),
  ('d8000000-0000-0000-0000-00000000000a', 'd8000000-0000-0000-0000-00000000000c', 'accepted'),
  ('d8000000-0000-0000-0000-00000000000a', 'd8000000-0000-0000-0000-00000000000d', 'accepted');

call pg_temp.as_user('d8000000-0000-0000-0000-00000000000a');
do $$
declare g public.groups;
begin
  g := public.create_group('四人牌友', array['d8000000-0000-0000-0000-00000000000b','d8000000-0000-0000-0000-00000000000c','d8000000-0000-0000-0000-00000000000d']::uuid[]);
  perform set_config('z.g', g.id::text, false);
end $$;

-- ===== 群桌：4 个座位，座位 3 能坐，座位 4 不行；机器人能加在 3 号位 =====
call pg_temp.as_user('d8000000-0000-0000-0000-00000000000b');
do $$
declare t public.ddz_games;
begin
  t := public.ddz_open(current_setting('z.g')::bigint);
  perform set_config('z.t', t.id::text, false);
  if cardinality(t.seats) <> 4 or cardinality(t.bots) <> 4 or cardinality(t.auto) <> 4 or t.dm_lo is not null or t.dm_hi is not null then
    raise exception 'new group table must have 4 seats: %', row_to_json(t);
  end if;
end $$;
call pg_temp.as_user('d8000000-0000-0000-0000-00000000000c');
call pg_temp.expect($$select public.ddz_sit(current_setting('z.t')::bigint, 4)$$, 'invalid_seat');
do $$
declare t public.ddz_games;
begin
  t := public.ddz_sit(current_setting('z.t')::bigint, 3);
  if t.seats[4] <> 'd8000000-0000-0000-0000-00000000000c' then raise exception 'carol should sit at slot 3: %', row_to_json(t); end if;
  t := public.ddz_set_bot(current_setting('z.t')::bigint, 2, true);
  if t.bots <> array[false, false, true, false] then raise exception 'bot at slot 2 expected: %', row_to_json(t); end if;
end $$;
call pg_temp.expect($$select public.ddz_set_bot(current_setting('z.t')::bigint, 4, true)$$, 'invalid_seat');
call pg_temp.expect($$select public.ddz_set_bot(current_setting('z.t')::bigint, 3, false)$$, 'not_a_bot');
do $$
declare t public.ddz_games;
begin
  t := public.ddz_set_bot(current_setting('z.t')::bigint, 2, false); -- 真人移除机器人
  t := public.ddz_stand(current_setting('z.t')::bigint);
  if t.seats[4] is not null then raise exception 'carol should have stood up'; end if;
end $$;

-- ===== 私聊开桌：要好友；非好友 / 自己 / 空 / anon 都不行 =====
call pg_temp.as_anon();
call pg_temp.expect($$select public.ddz_open_dm('d8000000-0000-0000-0000-00000000000b')$$, 'permission denied for function ddz_open_dm');
call pg_temp.as_user('d8000000-0000-0000-0000-00000000000e');
call pg_temp.expect($$select public.ddz_open_dm('d8000000-0000-0000-0000-00000000000a')$$, 'not_friends');
call pg_temp.expect($$select public.ddz_open_dm('d8000000-0000-0000-0000-00000000000e')$$, 'not_friends');
call pg_temp.expect($$select public.ddz_open_dm(null)$$, 'not_friends');
call pg_temp.as_user('d8000000-0000-0000-0000-00000000000c');
call pg_temp.expect($$select public.ddz_open_dm('d8000000-0000-0000-0000-00000000000d')$$, 'not_friends'); -- 同在一个群但不是好友

call pg_temp.as_user('d8000000-0000-0000-0000-00000000000a');
do $$
declare t public.ddz_games; m public.messages;
begin
  t := public.ddz_open_dm('d8000000-0000-0000-0000-00000000000b');
  perform set_config('z.d', t.id::text, false);
  if t.group_id is not null or t.dm_lo <> least('d8000000-0000-0000-0000-00000000000a'::uuid, 'd8000000-0000-0000-0000-00000000000b'::uuid)
     or t.dm_hi <> greatest('d8000000-0000-0000-0000-00000000000a'::uuid, 'd8000000-0000-0000-0000-00000000000b'::uuid)
     or t.status <> 'waiting' or t.seats <> array['d8000000-0000-0000-0000-00000000000a', null, null, null]::uuid[] then
    raise exception 'bad dm table: %', row_to_json(t);
  end if;
  select * into m from public.messages where id = t.message_id;
  if m.body <> '[斗地主]#' || t.id or m.sender_id <> 'd8000000-0000-0000-0000-00000000000a' or m.receiver_id <> 'd8000000-0000-0000-0000-00000000000b' or m.group_id is not null or m.author is not null then
    raise exception 'bad dm invite: %', row_to_json(m);
  end if;
end $$;
-- 一对好友一张桌：对方再开返回同一张，不再发第二条邀请（下面验证）
call pg_temp.as_user('d8000000-0000-0000-0000-00000000000b');
do $$
declare t public.ddz_games; n int;
begin
  t := public.ddz_open_dm('d8000000-0000-0000-0000-00000000000a');
  if t.id <> current_setting('z.d')::bigint then raise exception 'peer must get the same table'; end if;
  select count(*) into n from public.messages where body = '[斗地主]#' || t.id;
  if n <> 1 then raise exception 'one invite only, got %', n; end if;
end $$;
-- 另一对好友有自己的桌子
call pg_temp.as_user('d8000000-0000-0000-0000-00000000000a');
do $$
declare t public.ddz_games;
begin
  t := public.ddz_open_dm('d8000000-0000-0000-0000-00000000000c');
  perform set_config('z.d2', t.id::text, false);
  if t.id = current_setting('z.d')::bigint then raise exception 'other pair needs its own table'; end if;
end $$;
-- 唯一索引兜底
call pg_temp.as_admin();
call pg_temp.expect($$insert into public.ddz_games (dm_lo, dm_hi) select dm_lo, dm_hi from public.ddz_games where id = current_setting('z.d')::bigint$$,
  'duplicate key value violates unique constraint "ddz_games_one_open_dm"');
-- 群 / 私聊必须二选一，私聊的一对必须有序
call pg_temp.expect($$insert into public.ddz_games (group_id, dm_lo, dm_hi) select current_setting('z.g')::bigint, dm_lo, dm_hi from public.ddz_games where id = current_setting('z.d')::bigint$$,
  'new row for relation "ddz_games" violates check constraint "ddz_games_target_one"');
call pg_temp.expect($$insert into public.ddz_games (created_by) values (null)$$,
  'new row for relation "ddz_games" violates check constraint "ddz_games_target_one"');
call pg_temp.expect($$insert into public.ddz_games (dm_lo, dm_hi, status) select dm_hi, dm_lo, 'over' from public.ddz_games where id = current_setting('z.d')::bigint$$,
  'new row for relation "ddz_games" violates check constraint "ddz_games_target_one"');

-- ===== 可见性：只有这两个好友能看到私聊桌 =====
do $$
declare
  u text; n int;
  expect_n jsonb := '{"a":1,"b":1,"c":0,"d":0,"e":0}';
begin
  foreach u in array array['a','b','c','d','e'] loop
    perform set_config('request.jwt.claims', json_build_object('sub', ('d8000000-0000-0000-0000-00000000000' || u)::uuid, 'role', 'authenticated')::text, false);
    perform set_config('role', 'authenticated', false);
    select count(*) into n from public.ddz_games where id = current_setting('z.d')::bigint;
    perform set_config('role', 'postgres', false);
    if n <> (expect_n ->> u)::int then raise exception 'user % sees % rows of the dm table', u, n; end if;
  end loop;
end $$;
call pg_temp.as_anon();
call pg_temp.expect($$select count(*)::text from public.ddz_games where id = current_setting('z.d')::bigint$$, 'ok');

-- ===== 私聊里入座 / 换座 / 机器人 / 离座；外人和别的好友不能碰 =====
call pg_temp.as_user('d8000000-0000-0000-0000-00000000000e');
call pg_temp.expect($$select public.ddz_sit(current_setting('z.d')::bigint, 1)$$, 'not_friends');
call pg_temp.expect($$select public.ddz_set_bot(current_setting('z.d')::bigint, 1, true)$$, 'not_friends');
call pg_temp.expect($$select public.ddz_stand(current_setting('z.d')::bigint)$$, 'not_friends');
call pg_temp.as_user('d8000000-0000-0000-0000-00000000000c');
call pg_temp.expect($$select public.ddz_sit(current_setting('z.d')::bigint, 1)$$, 'not_friends');
call pg_temp.as_user('d8000000-0000-0000-0000-00000000000b');
do $$
declare t public.ddz_games;
begin
  t := public.ddz_sit(current_setting('z.d')::bigint, 3);
  if t.seats[4] <> 'd8000000-0000-0000-0000-00000000000b' then raise exception 'bob should sit at slot 3'; end if;
  t := public.ddz_set_bot(current_setting('z.d')::bigint, 1, true);
  t := public.ddz_set_bot(current_setting('z.d')::bigint, 2, true);
  if t.bots <> array[false, true, true, false] then raise exception 'two bots expected: %', row_to_json(t); end if;
  t := public.ddz_stand(current_setting('z.d')::bigint);
  if t.seats[4] is not null or t.status <> 'waiting' then raise exception 'bob stood up'; end if;
end $$;
call pg_temp.expect($$select public.ddz_set_bot(current_setting('z.d')::bigint, 1, false)$$, 'not_seated'); -- 站起来后不能再动桌子
call pg_temp.as_user('d8000000-0000-0000-0000-00000000000a');
do $$
declare t public.ddz_games;
begin
  t := public.ddz_set_bot(current_setting('z.d')::bigint, 1, false); -- 坐着的人可以移除机器人
  t := public.ddz_set_bot(current_setting('z.d')::bigint, 2, false);
  t := public.ddz_sit(current_setting('z.d')::bigint, 1);
  if t.seats <> array[null, 'd8000000-0000-0000-0000-00000000000a', null, null]::uuid[] then raise exception 'alice moved to slot 1: %', row_to_json(t); end if;
end $$;

-- ===== 提交：开始时座位压紧写进去；私聊积分按好友对累计，不写系统提示行；群积分和系统提示行照旧 =====
call pg_temp.as_admin();
do $$
declare ok boolean; v int; n int;
begin
  select version into v from public.ddz_games where id = current_setting('z.d')::bigint;
  ok := public.ddz_commit(current_setting('z.d')::bigint, v,
    '{"status":"bidding","pub":{"players":3},"seats":["d8000000-0000-0000-0000-00000000000a",null,null,null],"bots":[false,true,true,false],"auto":[false,false,false,false],"round":1,"deadline":"2030-01-01T00:00:00Z"}',
    '{"s":1}', '[{"seat":0,"user_id":"d8000000-0000-0000-0000-00000000000a","round":1,"cards":[1,2]}]', '[]', null, null);
  if not ok then raise exception 'start commit should succeed'; end if;
  perform 1 from public.ddz_games where id = current_setting('z.d')::bigint and seats = array['d8000000-0000-0000-0000-00000000000a', null, null, null]::uuid[] and bots = array[false,true,true,false];
  if not found then raise exception 'compacted seats not written'; end if;
  -- 对局结束：两笔积分
  select version into v from public.ddz_games where id = current_setting('z.d')::bigint;
  ok := public.ddz_commit(current_setting('z.d')::bigint, v, '{"status":"over","pub":{},"deadline":null}', '{"s":2}', '[]',
    '[{"user_id":"d8000000-0000-0000-0000-00000000000a","delta":6,"win":true}]', '斗地主：地主 a 赢了', 'd8000000-0000-0000-0000-00000000000a');
  select version into v from public.ddz_games where id = current_setting('z.d')::bigint;
  -- 同一对好友再开一局并结束：累计
  update public.ddz_games set status = 'over' where id = current_setting('z.d')::bigint;
  select count(*) into n from public.messages where author = 'system' and sender_id = 'd8000000-0000-0000-0000-00000000000a' and receiver_id is not null;
  if n <> 0 then raise exception 'no system line in dm'; end if;
  select count(*) into n from public.ddz_scores where group_id is null and dm_lo = (select dm_lo from public.ddz_games where id = current_setting('z.d')::bigint);
  if n <> 1 then raise exception 'one dm score row expected, got %', n; end if;
end $$;
call pg_temp.as_user('d8000000-0000-0000-0000-00000000000a');
do $$
declare t public.ddz_games; v int; sc public.ddz_scores; ok boolean;
begin
  t := public.ddz_open_dm('d8000000-0000-0000-0000-00000000000b'); -- 上一局 over 了，开新桌
  if t.id = current_setting('z.d')::bigint then raise exception 'new table after over'; end if;
  perform set_config('z.d3', t.id::text, false);
end $$;
call pg_temp.as_admin();
do $$
declare ok boolean; v int; sc public.ddz_scores;
begin
  select version into v from public.ddz_games where id = current_setting('z.d3')::bigint;
  ok := public.ddz_commit(current_setting('z.d3')::bigint, v, '{"status":"over","pub":{},"deadline":null}', '{"s":3}', '[]',
    '[{"user_id":"d8000000-0000-0000-0000-00000000000a","delta":-2,"win":false}]', null, null);
  select * into sc from public.ddz_scores where dm_lo is not null and user_id = 'd8000000-0000-0000-0000-00000000000a';
  if sc.total <> 4 or sc.games <> 2 or sc.wins <> 1 or sc.group_id is not null then raise exception 'dm scores should accumulate per pair: %', row_to_json(sc); end if;
end $$;
-- 积分的可见性：这一对好友能看到，别人不能
do $$
declare u text; n int; expect_n jsonb := '{"a":1,"b":1,"c":0,"d":0,"e":0}';
begin
  foreach u in array array['a','b','c','d','e'] loop
    perform set_config('request.jwt.claims', json_build_object('sub', ('d8000000-0000-0000-0000-00000000000' || u)::uuid, 'role', 'authenticated')::text, false);
    perform set_config('role', 'authenticated', false);
    select count(*) into n from public.ddz_scores where dm_lo is not null;
    perform set_config('role', 'postgres', false);
    if n <> (expect_n ->> u)::int then raise exception 'user % sees % dm score rows', u, n; end if;
  end loop;
end $$;
call pg_temp.as_admin();
-- 群积分：和以前一样按群累计（旧的群积分行结构不变），群里有系统提示行
do $$
declare ok boolean; v int; sc public.ddz_scores; n int; gid bigint := current_setting('z.g')::bigint;
begin
  insert into public.ddz_scores (group_id, user_id, total, games, wins) values (gid, 'd8000000-0000-0000-0000-00000000000b', 10, 3, 2); -- 模拟迁移前就存在的行
  select version into v from public.ddz_games where id = current_setting('z.t')::bigint;
  ok := public.ddz_commit(current_setting('z.t')::bigint, v, '{"status":"over","pub":{},"deadline":null}', '{"s":3}', '[]',
    '[{"user_id":"d8000000-0000-0000-0000-00000000000b","delta":4,"win":true}]', '斗地主：测试', 'd8000000-0000-0000-0000-00000000000b');
  select * into sc from public.ddz_scores where group_id = gid and user_id = 'd8000000-0000-0000-0000-00000000000b';
  if sc.total <> 14 or sc.games <> 4 or sc.wins <> 3 or sc.dm_lo is not null then raise exception 'group scores accumulate: %', row_to_json(sc); end if;
  select count(*) into n from public.messages where group_id = gid and author = 'system' and body = '斗地主：测试';
  if n <> 1 then raise exception 'group system line expected'; end if;
end $$;
call pg_temp.expect($$insert into public.ddz_scores (group_id, user_id) values (current_setting('z.g')::bigint, 'd8000000-0000-0000-0000-00000000000b')$$,
  'duplicate key value violates unique constraint "ddz_scores_group_key"');
call pg_temp.expect($$insert into public.ddz_scores (user_id) values ('d8000000-0000-0000-0000-00000000000b')$$,
  'new row for relation "ddz_scores" violates check constraint "ddz_scores_target_one"');
-- 手牌座位 0..3
call pg_temp.expect($$insert into public.ddz_hands (game_id, seat, user_id) values (current_setting('z.t')::bigint, 3, 'd8000000-0000-0000-0000-00000000000b')$$, 'ok');
call pg_temp.expect($$insert into public.ddz_hands (game_id, seat, user_id) values (current_setting('z.t')::bigint, 4, 'd8000000-0000-0000-0000-00000000000b')$$,
  'new row for relation "ddz_hands" violates check constraint "ddz_hands_seat_check"');

-- ===== 群成员离开：4 个座位里的真人座位变成托管 =====
call pg_temp.as_user('d8000000-0000-0000-0000-00000000000a');
do $$
declare t public.ddz_games; g public.groups;
begin
  g := public.create_group('离开测试', array['d8000000-0000-0000-0000-00000000000c','d8000000-0000-0000-0000-00000000000d']::uuid[]);
  perform set_config('z.g2', g.id::text, false);
  t := public.ddz_open(g.id);
  perform set_config('z.t2', t.id::text, false);
  t := public.ddz_sit(t.id, 3);
  t := public.ddz_set_bot(t.id, 1, true);
  t := public.ddz_set_bot(t.id, 2, true);
end $$;
call pg_temp.as_admin();
do $$
declare v int; ok boolean;
begin
  select version into v from public.ddz_games where id = current_setting('z.t2')::bigint;
  ok := public.ddz_commit(current_setting('z.t2')::bigint, v, '{"status":"playing","pub":{},"auto":[false,true,true,false],"round":1,"deadline":"2030-01-01T00:00:00Z"}', '{"s":1}',
    '[{"seat":3,"user_id":"d8000000-0000-0000-0000-00000000000a","round":1,"cards":[1]}]', '[]', null, null);
end $$;
call pg_temp.as_user('d8000000-0000-0000-0000-00000000000c');
do $$
declare t public.ddz_games;
begin
  select * into t from public.ddz_games where id = current_setting('z.t2')::bigint;
  if t.seats[4] is distinct from 'd8000000-0000-0000-0000-00000000000a'::uuid then raise exception 'alice should be at slot 3: %', row_to_json(t); end if;
end $$;
call pg_temp.as_admin();
delete from public.group_members where group_id = current_setting('z.g2')::bigint and user_id = 'd8000000-0000-0000-0000-00000000000a';
do $$
declare t public.ddz_games; n int;
begin
  select * into t from public.ddz_games where id = current_setting('z.t2')::bigint;
  if t.seats[4] is not null or t.bots[4] is not true or t.auto[4] is not true then raise exception 'slot 3 should become an auto bot: %', row_to_json(t); end if;
  if t.status <> 'closed' then raise exception 'no humans left: table closes, got %', t.status; end if;
  select count(*) into n from public.ddz_hands where game_id = t.id;
  if n <> 0 then raise exception 'hands of the removed member are deleted'; end if;
end $$;

-- ===== 好友关系结束：私聊桌关闭、手牌行删掉、看不到了 =====
call pg_temp.as_user('d8000000-0000-0000-0000-00000000000a');
do $$
declare t public.ddz_games;
begin
  t := public.ddz_open_dm('d8000000-0000-0000-0000-00000000000c');
  if t.id <> current_setting('z.d2')::bigint then raise exception 'same open table expected'; end if;
end $$;
call pg_temp.as_admin();
insert into public.ddz_hands (game_id, seat, user_id) values (current_setting('z.d2')::bigint, 0, 'd8000000-0000-0000-0000-00000000000a');
update public.friendships set status = 'declined' where least(requester_id, addressee_id) = least('d8000000-0000-0000-0000-00000000000a'::uuid, 'd8000000-0000-0000-0000-00000000000c'::uuid)
  and greatest(requester_id, addressee_id) = greatest('d8000000-0000-0000-0000-00000000000a'::uuid, 'd8000000-0000-0000-0000-00000000000c'::uuid);
do $$
declare t public.ddz_games; n int;
begin
  select * into t from public.ddz_games where id = current_setting('z.d2')::bigint;
  if t.status <> 'closed' then raise exception 'table must close when friendship ends: %', t.status; end if;
  select count(*) into n from public.ddz_hands where game_id = t.id;
  if n <> 0 then raise exception 'hands deleted'; end if;
end $$;
call pg_temp.as_user('d8000000-0000-0000-0000-00000000000a');
call pg_temp.expect($$select public.ddz_open_dm('d8000000-0000-0000-0000-00000000000c')$$, 'not_friends');
do $$
declare n int;
begin
  select count(*) into n from public.ddz_games where id = current_setting('z.d2')::bigint;
  if n <> 0 then raise exception 'ex-friend must not see the table'; end if;
end $$;
-- 删除好友行（真的删掉）：alice 和 bob 新开一张桌，再删掉他们的好友行，桌子关闭
call pg_temp.as_admin();
do $$
declare t public.ddz_games;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'd8000000-0000-0000-0000-00000000000a', 'role', 'authenticated')::text, false);
  t := public.ddz_open_dm('d8000000-0000-0000-0000-00000000000b');
  perform set_config('z.d4', t.id::text, false);
end $$;
delete from public.friendships where least(requester_id, addressee_id) = least('d8000000-0000-0000-0000-00000000000a'::uuid, 'd8000000-0000-0000-0000-00000000000b'::uuid)
  and greatest(requester_id, addressee_id) = greatest('d8000000-0000-0000-0000-00000000000a'::uuid, 'd8000000-0000-0000-0000-00000000000b'::uuid);
do $$
begin
  if (select status from public.ddz_games where id = current_setting('z.d4')::bigint) <> 'closed' then raise exception 'delete friendship closes the table'; end if;
end $$;

delete from auth.users where email like '%@ddz4-test.local';
select 'ddz 4p + dm ok';
