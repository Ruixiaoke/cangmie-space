-- 麻将：4 个座位 / 群桌和私聊桌 / 一个群或一对好友一张桌 / 非好友和外人不能碰 / 手牌只有本人能读，完整状态谁也读不到 / 积分按群或按好友对累计 / 好友关系结束或成员离开时的处理 / 排行榜，CI 在临时 Postgres 上运行
\set ON_ERROR_STOP on
\set QUIET on

delete from auth.users where email like '%@mj-test.local';

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

-- 数一下当前角色能看到几行
create function pg_temp.cnt(q text) returns int language plpgsql as $$
declare n int;
begin
  execute 'select count(*) from (' || q || ') x' into n;
  return n;
end $$;

insert into auth.users (id, email) values
  ('e1000000-0000-0000-0000-00000000000a', 'z_alice@mj-test.local'),
  ('e1000000-0000-0000-0000-00000000000b', 'z_bob@mj-test.local'),
  ('e1000000-0000-0000-0000-00000000000c', 'z_carol@mj-test.local'),
  ('e1000000-0000-0000-0000-00000000000d', 'z_dave@mj-test.local'),
  ('e1000000-0000-0000-0000-00000000000e', 'z_eve@mj-test.local');

-- alice 和 bob、carol、dave 都是好友（bob、carol、dave 之间不是好友）；eve 谁也不认识
insert into public.friendships (requester_id, addressee_id, status) values
  ('e1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000b', 'accepted'),
  ('e1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000c', 'accepted'),
  ('e1000000-0000-0000-0000-00000000000a', 'e1000000-0000-0000-0000-00000000000d', 'accepted');

call pg_temp.as_user('e1000000-0000-0000-0000-00000000000a');
do $$
declare g public.groups;
begin
  g := public.create_group('麻将牌友', array['e1000000-0000-0000-0000-00000000000b','e1000000-0000-0000-0000-00000000000c','e1000000-0000-0000-0000-00000000000d']::uuid[]);
  perform set_config('z.g', g.id::text, false);
end $$;

-- ===== 群桌：4 个座位，座位 3 能坐，座位 4 不行；机器人能加在 2 号位；匿名不能开 =====
call pg_temp.as_anon();
call pg_temp.expect($$select public.mj_open(1)$$, 'permission denied for function mj_open');
call pg_temp.as_user('e1000000-0000-0000-0000-00000000000e');
call pg_temp.expect($$select public.mj_open(current_setting('z.g')::bigint)$$, 'not_group_member');
call pg_temp.as_user('e1000000-0000-0000-0000-00000000000b');
do $$
declare t public.mj_games; n int; m public.messages;
begin
  t := public.mj_open(current_setting('z.g')::bigint);
  perform set_config('z.t', t.id::text, false);
  if cardinality(t.seats) <> 4 or cardinality(t.bots) <> 4 or cardinality(t.auto) <> 4 or t.dm_lo is not null or t.dm_hi is not null or t.status <> 'waiting' or t.seats[1] <> 'e1000000-0000-0000-0000-00000000000b' then
    raise exception 'new group table must have 4 seats, opener at slot 0: %', row_to_json(t);
  end if;
  select * into m from public.messages where id = t.message_id;
  if m.body <> '[麻将]#' || t.id or m.sender_id <> 'e1000000-0000-0000-0000-00000000000b' or m.group_id <> current_setting('z.g')::bigint or m.receiver_id is not null then
    raise exception 'bad group invite: %', row_to_json(m);
  end if;
  -- 每个群一张：再开返回同一张，不再发第二条邀请
  t := public.mj_open(current_setting('z.g')::bigint);
  select count(*) into n from public.messages where body = '[麻将]#' || t.id;
  if t.id <> current_setting('z.t')::bigint or n <> 1 then raise exception 'one table and one invite per group'; end if;
end $$;
call pg_temp.as_user('e1000000-0000-0000-0000-00000000000c');
call pg_temp.expect($$select public.mj_sit(current_setting('z.t')::bigint, 4)$$, 'invalid_seat');
call pg_temp.expect($$select public.mj_sit(current_setting('z.t')::bigint, 0)$$, 'seat_taken');
do $$
declare t public.mj_games;
begin
  t := public.mj_sit(current_setting('z.t')::bigint, 3);
  if t.seats[4] <> 'e1000000-0000-0000-0000-00000000000c' then raise exception 'carol should sit at slot 3: %', row_to_json(t); end if;
  t := public.mj_sit(current_setting('z.t')::bigint, 2); -- 换座
  if t.seats[4] is not null or t.seats[3] <> 'e1000000-0000-0000-0000-00000000000c' then raise exception 'carol moved to slot 2: %', row_to_json(t); end if;
  t := public.mj_set_bot(current_setting('z.t')::bigint, 3, true);
  if t.bots <> array[false, false, false, true] then raise exception 'bot at slot 3 expected: %', row_to_json(t); end if;
end $$;
call pg_temp.expect($$select public.mj_set_bot(current_setting('z.t')::bigint, 4, true)$$, 'invalid_seat');
call pg_temp.expect($$select public.mj_set_bot(current_setting('z.t')::bigint, 3, true)$$, 'seat_taken');
call pg_temp.expect($$select public.mj_set_bot(current_setting('z.t')::bigint, 2, false)$$, 'not_a_bot');
-- 外人不能碰
call pg_temp.as_user('e1000000-0000-0000-0000-00000000000e');
call pg_temp.expect($$select public.mj_sit(current_setting('z.t')::bigint, 1)$$, 'not_group_member');
call pg_temp.expect($$select public.mj_stand(current_setting('z.t')::bigint)$$, 'not_group_member');
call pg_temp.as_user('e1000000-0000-0000-0000-00000000000d');
call pg_temp.expect($$select public.mj_stand(current_setting('z.t')::bigint)$$, 'not_seated'); -- 没坐下的人不能离座
call pg_temp.expect($$select public.mj_set_bot(current_setting('z.t')::bigint, 1, true)$$, 'not_seated');
call pg_temp.as_user('e1000000-0000-0000-0000-00000000000c');
do $$
declare t public.mj_games;
begin
  t := public.mj_set_bot(current_setting('z.t')::bigint, 3, false);
  t := public.mj_stand(current_setting('z.t')::bigint);
  if t.seats[3] is not null then raise exception 'carol should have stood up'; end if;
end $$;

-- ===== 私聊开桌：要好友；非好友 / 自己 / 空 / anon 都不行 =====
call pg_temp.as_anon();
call pg_temp.expect($$select public.mj_open_dm('e1000000-0000-0000-0000-00000000000b')$$, 'permission denied for function mj_open_dm');
call pg_temp.as_user('e1000000-0000-0000-0000-00000000000e');
call pg_temp.expect($$select public.mj_open_dm('e1000000-0000-0000-0000-00000000000a')$$, 'not_friends');
call pg_temp.expect($$select public.mj_open_dm('e1000000-0000-0000-0000-00000000000e')$$, 'not_friends');
call pg_temp.expect($$select public.mj_open_dm(null)$$, 'not_friends');
call pg_temp.as_user('e1000000-0000-0000-0000-00000000000c');
call pg_temp.expect($$select public.mj_open_dm('e1000000-0000-0000-0000-00000000000d')$$, 'not_friends'); -- 同在一个群但不是好友

call pg_temp.as_user('e1000000-0000-0000-0000-00000000000a');
do $$
declare t public.mj_games; m public.messages;
begin
  t := public.mj_open_dm('e1000000-0000-0000-0000-00000000000b');
  perform set_config('z.d', t.id::text, false);
  if t.group_id is not null or t.dm_lo <> least('e1000000-0000-0000-0000-00000000000a'::uuid, 'e1000000-0000-0000-0000-00000000000b'::uuid)
     or t.dm_hi <> greatest('e1000000-0000-0000-0000-00000000000a'::uuid, 'e1000000-0000-0000-0000-00000000000b'::uuid)
     or t.status <> 'waiting' or t.seats <> array['e1000000-0000-0000-0000-00000000000a', null, null, null]::uuid[] then
    raise exception 'bad dm table: %', row_to_json(t);
  end if;
  select * into m from public.messages where id = t.message_id;
  if m.body <> '[麻将]#' || t.id or m.sender_id <> 'e1000000-0000-0000-0000-00000000000a' or m.receiver_id <> 'e1000000-0000-0000-0000-00000000000b' or m.group_id is not null or m.author is not null then
    raise exception 'bad dm invite: %', row_to_json(m);
  end if;
end $$;
-- 一对好友一张桌：对方再开返回同一张，不再发第二条邀请
call pg_temp.as_user('e1000000-0000-0000-0000-00000000000b');
do $$
declare t public.mj_games; n int;
begin
  t := public.mj_open_dm('e1000000-0000-0000-0000-00000000000a');
  if t.id <> current_setting('z.d')::bigint then raise exception 'peer must get the same table'; end if;
  select count(*) into n from public.messages where body = '[麻将]#' || t.id;
  if n <> 1 then raise exception 'one invite only, got %', n; end if;
end $$;
-- 另一对好友有自己的桌子
call pg_temp.as_user('e1000000-0000-0000-0000-00000000000a');
do $$
declare t public.mj_games;
begin
  t := public.mj_open_dm('e1000000-0000-0000-0000-00000000000c');
  perform set_config('z.d2', t.id::text, false);
  if t.id = current_setting('z.d')::bigint then raise exception 'other pair needs its own table'; end if;
end $$;
-- 唯一索引兜底；群 / 私聊二选一，私聊的一对必须有序
call pg_temp.as_admin();
call pg_temp.expect($$insert into public.mj_games (dm_lo, dm_hi) select dm_lo, dm_hi from public.mj_games where id = current_setting('z.d')::bigint$$,
  'duplicate key value violates unique constraint "mj_games_one_open_dm"');
call pg_temp.expect($$insert into public.mj_games (group_id, created_by) values (current_setting('z.g')::bigint, null)$$,
  'duplicate key value violates unique constraint "mj_games_one_open"');
call pg_temp.expect($$insert into public.mj_games (group_id, dm_lo, dm_hi) select current_setting('z.g')::bigint, dm_lo, dm_hi from public.mj_games where id = current_setting('z.d')::bigint$$,
  'new row for relation "mj_games" violates check constraint "mj_games_target_one"');
call pg_temp.expect($$insert into public.mj_games (created_by) values (null)$$,
  'new row for relation "mj_games" violates check constraint "mj_games_target_one"');
call pg_temp.expect($$insert into public.mj_games (dm_lo, dm_hi, status) select dm_hi, dm_lo, 'over' from public.mj_games where id = current_setting('z.d')::bigint$$,
  'new row for relation "mj_games" violates check constraint "mj_games_target_one"');
call pg_temp.expect($$update public.mj_games set seats = array[null, null, null]::uuid[] where id = current_setting('z.d')::bigint$$,
  'new row for relation "mj_games" violates check constraint "mj_games_seats_len"');
call pg_temp.expect($$update public.mj_games set status = 'bidding' where id = current_setting('z.d')::bigint$$,
  'new row for relation "mj_games" violates check constraint "mj_games_status_valid"');

-- ===== 可见性：私聊桌只有这两个好友能看到；群桌只有群成员 =====
do $$
declare
  u text; n int;
  expect_dm jsonb := '{"a":1,"b":1,"c":0,"d":0,"e":0}';
  expect_grp jsonb := '{"a":1,"b":1,"c":1,"d":1,"e":0}';
begin
  foreach u in array array['a','b','c','d','e'] loop
    perform set_config('request.jwt.claims', json_build_object('sub', ('e1000000-0000-0000-0000-00000000000' || u)::uuid, 'role', 'authenticated')::text, false);
    perform set_config('role', 'authenticated', false);
    select count(*) into n from public.mj_games where id = current_setting('z.d')::bigint;
    if n <> (expect_dm ->> u)::int then raise exception 'user % sees % rows of the dm table', u, n; end if;
    select count(*) into n from public.mj_games where id = current_setting('z.t')::bigint;
    if n <> (expect_grp ->> u)::int then raise exception 'user % sees % rows of the group table', u, n; end if;
    perform set_config('role', 'postgres', false);
  end loop;
end $$;
call pg_temp.as_anon();
do $$ begin if pg_temp.cnt('select 1 from public.mj_games') <> 0 then raise exception 'anon sees tables'; end if; end $$;

-- ===== 私聊里入座 / 换座 / 机器人 / 离座；外人和别的好友不能碰 =====
call pg_temp.as_user('e1000000-0000-0000-0000-00000000000e');
call pg_temp.expect($$select public.mj_sit(current_setting('z.d')::bigint, 1)$$, 'not_friends');
call pg_temp.expect($$select public.mj_set_bot(current_setting('z.d')::bigint, 1, true)$$, 'not_friends');
call pg_temp.expect($$select public.mj_stand(current_setting('z.d')::bigint)$$, 'not_friends');
call pg_temp.as_user('e1000000-0000-0000-0000-00000000000c');
call pg_temp.expect($$select public.mj_sit(current_setting('z.d')::bigint, 1)$$, 'not_friends');
call pg_temp.as_user('e1000000-0000-0000-0000-00000000000b');
do $$
declare t public.mj_games;
begin
  t := public.mj_sit(current_setting('z.d')::bigint, 3);
  if t.seats[4] <> 'e1000000-0000-0000-0000-00000000000b' then raise exception 'bob should sit at slot 3'; end if;
  t := public.mj_set_bot(current_setting('z.d')::bigint, 1, true);
  t := public.mj_set_bot(current_setting('z.d')::bigint, 2, true);
  if t.bots <> array[false, true, true, false] then raise exception 'two bots expected: %', row_to_json(t); end if;
  t := public.mj_stand(current_setting('z.d')::bigint);
  if t.seats[4] is not null or t.status <> 'waiting' then raise exception 'bob stood up'; end if;
end $$;
call pg_temp.expect($$select public.mj_set_bot(current_setting('z.d')::bigint, 1, false)$$, 'not_seated'); -- 站起来后不能再动桌子
call pg_temp.as_user('e1000000-0000-0000-0000-00000000000a');
do $$
declare t public.mj_games;
begin
  t := public.mj_set_bot(current_setting('z.d')::bigint, 1, false); -- 坐着的人可以移除机器人
  t := public.mj_set_bot(current_setting('z.d')::bigint, 2, false);
  t := public.mj_sit(current_setting('z.d')::bigint, 1);
  if t.seats <> array[null, 'e1000000-0000-0000-0000-00000000000a', null, null]::uuid[] then raise exception 'alice moved to slot 1: %', row_to_json(t); end if;
end $$;

-- ===== 提交（Edge Function 用）：开始补机器人；手牌行每步重写；积分按好友对累计，私聊不写系统提示行 =====
call pg_temp.as_user('e1000000-0000-0000-0000-00000000000a');
call pg_temp.expect($$select public.mj_commit(1, 1, '{}', '{}', '[]', '[]', null, null)$$, 'permission denied for function mj_commit');
call pg_temp.as_admin();
do $$
declare ok boolean; v int; n int; gid bigint := current_setting('z.d')::bigint;
begin
  select version into v from public.mj_games where id = gid;
  -- 版本不对：什么也不写
  ok := public.mj_commit(gid, v + 5, '{"status":"playing","pub":{}}', '{"s":0}', '[]', '[]', null, null);
  if ok then raise exception 'stale version must be refused'; end if;
  ok := public.mj_commit(gid, v,
    '{"status":"playing","pub":{"step":0,"wallLeft":83},"seats":[null,"e1000000-0000-0000-0000-00000000000a",null,null],"bots":[true,false,true,true],"auto":[false,false,false,false],"round":1,"deadline":"2030-01-01T00:00:00Z"}',
    '{"g":{"wall":[1,2,3]}}',
    '[{"seat":1,"user_id":"e1000000-0000-0000-0000-00000000000a","round":1,"step":0,"cards":[1,2,3,4],"drawn":4,"opts":{"mode":"turn","hu":false,"angang":[],"bugang":[]},"ag":[]}]',
    '[]', null, null);
  if not ok then raise exception 'start commit should succeed'; end if;
  perform 1 from public.mj_games where id = gid and status = 'playing' and bots = array[true,false,true,true] and round = 1 and version = v + 1;
  if not found then raise exception 'start patch not written'; end if;
  select count(*) into n from public.mj_hands where game_id = gid and seat = 1 and cards = array[1,2,3,4]::smallint[] and drawn = 4 and opts ->> 'mode' = 'turn';
  if n <> 1 then raise exception 'hand row not written'; end if;
  -- 下一步：手牌行被覆盖（opts 变成 null）
  select version into v from public.mj_games where id = gid;
  ok := public.mj_commit(gid, v, '{"status":"playing","pub":{"step":1},"auto":[false,false,false,false],"round":1,"deadline":"2030-01-01T00:00:20Z"}', '{"g":{}}',
    '[{"seat":1,"user_id":"e1000000-0000-0000-0000-00000000000a","round":1,"step":1,"cards":[1,2,3],"drawn":null,"opts":null,"ag":[7]}]', '[]', null, null);
  select count(*) into n from public.mj_hands where game_id = gid and step = 1 and cards = array[1,2,3]::smallint[] and drawn is null and opts is null and ag = array[7]::smallint[];
  if n <> 1 then raise exception 'hand row should be overwritten'; end if;
  -- 对局结束：一笔积分，私聊里没有系统提示行
  select version into v from public.mj_games where id = gid;
  ok := public.mj_commit(gid, v, '{"status":"over","pub":{},"deadline":null}', '{"s":2}', '[]',
    '[{"user_id":"e1000000-0000-0000-0000-00000000000a","delta":6,"win":true}]', '麻将：流局', 'e1000000-0000-0000-0000-00000000000a');
  select count(*) into n from public.messages where author = 'system' and sender_id = 'e1000000-0000-0000-0000-00000000000a' and receiver_id is not null;
  if n <> 0 then raise exception 'no system line in dm'; end if;
  select count(*) into n from public.mj_scores where group_id is null and dm_lo = (select dm_lo from public.mj_games where id = gid);
  if n <> 1 then raise exception 'one dm score row expected, got %', n; end if;
end $$;
call pg_temp.as_user('e1000000-0000-0000-0000-00000000000a');
do $$
declare t public.mj_games;
begin
  t := public.mj_open_dm('e1000000-0000-0000-0000-00000000000b'); -- 上一局 over 了，开新桌
  if t.id = current_setting('z.d')::bigint then raise exception 'new table after over'; end if;
  perform set_config('z.d3', t.id::text, false);
end $$;
call pg_temp.as_admin();
do $$
declare ok boolean; v int; sc public.mj_scores;
begin
  select version into v from public.mj_games where id = current_setting('z.d3')::bigint;
  ok := public.mj_commit(current_setting('z.d3')::bigint, v, '{"status":"over","pub":{},"deadline":null}', '{"s":3}', '[]',
    '[{"user_id":"e1000000-0000-0000-0000-00000000000a","delta":-2,"win":false}]', null, null);
  select * into sc from public.mj_scores where dm_lo is not null and user_id = 'e1000000-0000-0000-0000-00000000000a';
  if sc.total <> 4 or sc.games <> 2 or sc.wins <> 1 or sc.group_id is not null then raise exception 'dm scores should accumulate per pair: %', row_to_json(sc); end if;
end $$;
-- 私聊积分只有这一对好友能看到
do $$
declare u text; n int; expect_n jsonb := '{"a":1,"b":1,"c":0,"d":0,"e":0}';
begin
  foreach u in array array['a','b','c','d','e'] loop
    perform set_config('request.jwt.claims', json_build_object('sub', ('e1000000-0000-0000-0000-00000000000' || u)::uuid, 'role', 'authenticated')::text, false);
    perform set_config('role', 'authenticated', false);
    select count(*) into n from public.mj_scores where dm_lo is not null;
    perform set_config('role', 'postgres', false);
    if n <> (expect_n ->> u)::int then raise exception 'user % sees % dm score rows', u, n; end if;
  end loop;
end $$;
call pg_temp.as_admin();
-- 群积分：按群累计，群里有系统提示行
do $$
declare ok boolean; v int; sc public.mj_scores; n int; gid bigint := current_setting('z.g')::bigint;
begin
  select version into v from public.mj_games where id = current_setting('z.t')::bigint;
  ok := public.mj_commit(current_setting('z.t')::bigint, v, '{"status":"over","pub":{},"deadline":null}', '{"s":3}', '[]',
    '[{"user_id":"e1000000-0000-0000-0000-00000000000b","delta":6,"win":true},{"user_id":"e1000000-0000-0000-0000-00000000000c","delta":-2,"win":false}]', '麻将：测试', 'e1000000-0000-0000-0000-00000000000b');
  select * into sc from public.mj_scores where group_id = gid and user_id = 'e1000000-0000-0000-0000-00000000000b';
  if sc.total <> 6 or sc.games <> 1 or sc.wins <> 1 or sc.dm_lo is not null then raise exception 'group scores: %', row_to_json(sc); end if;
  select count(*) into n from public.messages where group_id = gid and author = 'system' and body = '麻将：测试';
  if n <> 1 then raise exception 'group system line expected'; end if;
  -- 再开一桌再结算：累计
  update public.mj_games set status = 'over' where id = current_setting('z.t')::bigint;
end $$;
call pg_temp.as_user('e1000000-0000-0000-0000-00000000000b');
do $$
declare t public.mj_games;
begin
  t := public.mj_open(current_setting('z.g')::bigint);
  if t.id = current_setting('z.t')::bigint then raise exception 'new group table after over'; end if;
  perform set_config('z.t2', t.id::text, false);
end $$;
call pg_temp.as_admin();
do $$
declare ok boolean; v int; sc public.mj_scores;
begin
  select version into v from public.mj_games where id = current_setting('z.t2')::bigint;
  ok := public.mj_commit(current_setting('z.t2')::bigint, v, '{"status":"over","pub":{},"deadline":null}', '{"s":4}', '[]',
    '[{"user_id":"e1000000-0000-0000-0000-00000000000b","delta":-3,"win":false}]', null, null);
  select * into sc from public.mj_scores where group_id = current_setting('z.g')::bigint and user_id = 'e1000000-0000-0000-0000-00000000000b';
  if sc.total <> 3 or sc.games <> 2 or sc.wins <> 1 then raise exception 'group scores accumulate: %', row_to_json(sc); end if;
end $$;
call pg_temp.expect($$insert into public.mj_scores (group_id, user_id) values (current_setting('z.g')::bigint, 'e1000000-0000-0000-0000-00000000000b')$$,
  'duplicate key value violates unique constraint "mj_scores_group_key"');
call pg_temp.expect($$insert into public.mj_scores (user_id) values ('e1000000-0000-0000-0000-00000000000b')$$,
  'new row for relation "mj_scores" violates check constraint "mj_scores_target_one"');
call pg_temp.expect($$insert into public.mj_hands (game_id, seat, user_id) values (current_setting('z.t')::bigint, 4, 'e1000000-0000-0000-0000-00000000000b')$$,
  'new row for relation "mj_hands" violates check constraint "mj_hands_seat_check"');

-- ===== 手牌是秘密：每个人只能读自己的那一行；完整状态谁也读不到 =====
call pg_temp.as_admin();
insert into public.mj_hands (game_id, seat, user_id, cards) values
  (current_setting('z.t2')::bigint, 0, 'e1000000-0000-0000-0000-00000000000b', array[1,2,3]::smallint[]),
  (current_setting('z.t2')::bigint, 1, 'e1000000-0000-0000-0000-00000000000c', array[4,5,6]::smallint[]),
  (current_setting('z.t2')::bigint, 2, 'e1000000-0000-0000-0000-00000000000d', array[7,8,9]::smallint[])
  on conflict (game_id, seat) do nothing;
insert into public.mj_state (game_id, state) values (current_setting('z.t2')::bigint, '{"g":{"wall":[1],"hands":[[1],[2],[3],[4]]}}') on conflict (game_id) do nothing;
do $$
declare u text; n int; s int;
begin
  foreach u in array array['b','c','d'] loop
    perform set_config('request.jwt.claims', json_build_object('sub', ('e1000000-0000-0000-0000-00000000000' || u)::uuid, 'role', 'authenticated')::text, false);
    perform set_config('role', 'authenticated', false);
    select count(*) into n from public.mj_hands where game_id = current_setting('z.t2')::bigint;
    select count(*) into s from public.mj_hands where game_id = current_setting('z.t2')::bigint and user_id <> ('e1000000-0000-0000-0000-00000000000' || u)::uuid;
    perform set_config('role', 'postgres', false);
    if n <> 1 or s <> 0 then raise exception 'user % must only see its own hand row (saw %, others %)', u, n, s; end if;
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', 'e1000000-0000-0000-0000-00000000000e', 'role', 'authenticated')::text, false);
  perform set_config('role', 'authenticated', false);
  select count(*) into n from public.mj_hands;
  perform set_config('role', 'postgres', false);
  if n <> 0 then raise exception 'outsider sees hand rows'; end if;
end $$;
call pg_temp.as_user('e1000000-0000-0000-0000-00000000000b');
call pg_temp.expect($$select count(*)::text from public.mj_state$$, 'permission denied for table mj_state');
call pg_temp.expect($$insert into public.mj_hands (game_id, seat, user_id) values (current_setting('z.t2')::bigint, 3, 'e1000000-0000-0000-0000-00000000000b')$$, 'permission denied for table mj_hands');
call pg_temp.expect($$update public.mj_games set status = 'over'$$, 'permission denied for table mj_games');
call pg_temp.expect($$update public.mj_scores set total = 999$$, 'permission denied for table mj_scores');
call pg_temp.as_anon();
do $$ begin if pg_temp.cnt('select 1 from public.mj_hands') <> 0 then raise exception 'anon sees hands'; end if; end $$;

-- ===== 群成员离开：4 个座位里的真人座位变成托管，没有真人了就关桌，手牌行删掉 =====
call pg_temp.as_user('e1000000-0000-0000-0000-00000000000a');
do $$
declare t public.mj_games; g public.groups;
begin
  g := public.create_group('离开测试', array['e1000000-0000-0000-0000-00000000000c','e1000000-0000-0000-0000-00000000000d']::uuid[]);
  perform set_config('z.g2', g.id::text, false);
  t := public.mj_open(g.id);
  perform set_config('z.t3', t.id::text, false);
  t := public.mj_sit(t.id, 3);
  t := public.mj_set_bot(t.id, 1, true);
  t := public.mj_set_bot(t.id, 2, true);
end $$;
call pg_temp.as_user('e1000000-0000-0000-0000-00000000000c');
do $$
declare t public.mj_games;
begin
  t := public.mj_sit(current_setting('z.t3')::bigint, 0); -- 等人时 carol 也坐下
  if t.seats[1] <> 'e1000000-0000-0000-0000-00000000000c' then raise exception 'carol at slot 0'; end if;
end $$;
-- 等人时离开群：座位空出来，桌子还在（alice 还坐着）
call pg_temp.as_admin();
delete from public.group_members where group_id = current_setting('z.g2')::bigint and user_id = 'e1000000-0000-0000-0000-00000000000c';
do $$
declare t public.mj_games;
begin
  select * into t from public.mj_games where id = current_setting('z.t3')::bigint;
  if t.seats[1] is not null or t.bots[1] is not false or t.status <> 'waiting' then raise exception 'waiting: seat freed: %', row_to_json(t); end if;
end $$;
do $$
declare v int; ok boolean;
begin
  select version into v from public.mj_games where id = current_setting('z.t3')::bigint;
  ok := public.mj_commit(current_setting('z.t3')::bigint, v, '{"status":"playing","pub":{},"seats":[null,null,null,"e1000000-0000-0000-0000-00000000000a"],"bots":[true,true,true,false],"auto":[false,false,false,false],"round":1,"deadline":"2030-01-01T00:00:00Z"}', '{"s":1}',
    '[{"seat":3,"user_id":"e1000000-0000-0000-0000-00000000000a","round":1,"step":0,"cards":[1],"drawn":null,"opts":null,"ag":[]}]', '[]', null, null);
end $$;
delete from public.group_members where group_id = current_setting('z.g2')::bigint and user_id = 'e1000000-0000-0000-0000-00000000000a';
do $$
declare t public.mj_games; n int;
begin
  select * into t from public.mj_games where id = current_setting('z.t3')::bigint;
  if t.seats[4] is not null or t.bots[4] is not true or t.auto[4] is not true then raise exception 'slot 3 should become an auto bot: %', row_to_json(t); end if;
  if t.status <> 'closed' then raise exception 'no humans left: table closes, got %', t.status; end if;
  select count(*) into n from public.mj_hands where game_id = t.id;
  if n <> 0 then raise exception 'hands of the removed member are deleted'; end if;
end $$;

-- ===== 好友关系结束：私聊桌关闭、手牌行删掉、看不到了 =====
call pg_temp.as_user('e1000000-0000-0000-0000-00000000000a');
do $$
declare t public.mj_games;
begin
  t := public.mj_open_dm('e1000000-0000-0000-0000-00000000000c');
  if t.id <> current_setting('z.d2')::bigint then raise exception 'same open table expected'; end if;
end $$;
call pg_temp.as_admin();
insert into public.mj_hands (game_id, seat, user_id) values (current_setting('z.d2')::bigint, 0, 'e1000000-0000-0000-0000-00000000000a');
update public.friendships set status = 'declined' where least(requester_id, addressee_id) = least('e1000000-0000-0000-0000-00000000000a'::uuid, 'e1000000-0000-0000-0000-00000000000c'::uuid)
  and greatest(requester_id, addressee_id) = greatest('e1000000-0000-0000-0000-00000000000a'::uuid, 'e1000000-0000-0000-0000-00000000000c'::uuid);
do $$
declare t public.mj_games; n int;
begin
  select * into t from public.mj_games where id = current_setting('z.d2')::bigint;
  if t.status <> 'closed' then raise exception 'table must close when friendship ends: %', t.status; end if;
  select count(*) into n from public.mj_hands where game_id = t.id;
  if n <> 0 then raise exception 'hands deleted'; end if;
end $$;
call pg_temp.as_user('e1000000-0000-0000-0000-00000000000a');
call pg_temp.expect($$select public.mj_open_dm('e1000000-0000-0000-0000-00000000000c')$$, 'not_friends');
do $$
declare n int;
begin
  select count(*) into n from public.mj_games where id = current_setting('z.d2')::bigint;
  if n <> 0 then raise exception 'ex-friend must not see the table'; end if;
end $$;
-- 真的删掉好友行：alice 和 bob 的桌子关闭
call pg_temp.as_admin();
do $$
declare t public.mj_games;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', 'e1000000-0000-0000-0000-00000000000a', 'role', 'authenticated')::text, false);
  t := public.mj_open_dm('e1000000-0000-0000-0000-00000000000b');
  perform set_config('z.d4', t.id::text, false);
end $$;
delete from public.friendships where least(requester_id, addressee_id) = least('e1000000-0000-0000-0000-00000000000a'::uuid, 'e1000000-0000-0000-0000-00000000000b'::uuid)
  and greatest(requester_id, addressee_id) = greatest('e1000000-0000-0000-0000-00000000000a'::uuid, 'e1000000-0000-0000-0000-00000000000b'::uuid);
do $$
begin
  if (select status from public.mj_games where id = current_setting('z.d4')::bigint) <> 'closed' then raise exception 'delete friendship closes the table'; end if;
end $$;

-- ===== 排行榜 mj_leaderboard：好友榜把群行和私聊行加起来 / 不含非好友 / 本群榜只算这个群 / 非成员被拒 / 按积分再按胜场排序 / 负分 / 只有我可以是 0 局 =====
call pg_temp.as_admin();
delete from public.mj_scores;
insert into auth.users (id, email) values
  ('e2000000-0000-0000-0000-00000000000a', 'a_me@mj-test.local'),
  ('e2000000-0000-0000-0000-00000000000b', 'b_bob@mj-test.local'),
  ('e2000000-0000-0000-0000-00000000000c', 'c_carol@mj-test.local'),
  ('e2000000-0000-0000-0000-00000000000d', 'd_dan@mj-test.local'),
  ('e2000000-0000-0000-0000-00000000000e', 'e_erin@mj-test.local'),
  ('e2000000-0000-0000-0000-00000000000f', 'f_gus@mj-test.local');
-- me 的好友：bob、dan、erin；carol 不是我的好友（bob 的好友）；gus 只认识 dan
insert into public.friendships (requester_id, addressee_id, status) values
  ('e2000000-0000-0000-0000-00000000000a', 'e2000000-0000-0000-0000-00000000000b', 'accepted'),
  ('e2000000-0000-0000-0000-00000000000d', 'e2000000-0000-0000-0000-00000000000a', 'accepted'),
  ('e2000000-0000-0000-0000-00000000000a', 'e2000000-0000-0000-0000-00000000000e', 'accepted'),
  ('e2000000-0000-0000-0000-00000000000b', 'e2000000-0000-0000-0000-00000000000c', 'accepted'),
  ('e2000000-0000-0000-0000-00000000000f', 'e2000000-0000-0000-0000-00000000000d', 'accepted');
do $$
declare g1 bigint; g2 bigint;
begin
  insert into public.groups (name, owner_id) values ('lb 群一', 'e2000000-0000-0000-0000-00000000000a') returning id into g1;
  insert into public.groups (name, owner_id) values ('lb 群二', 'e2000000-0000-0000-0000-00000000000a') returning id into g2;
  insert into public.group_members (group_id, user_id) values
    (g1, 'e2000000-0000-0000-0000-00000000000a'), (g1, 'e2000000-0000-0000-0000-00000000000b'),
    (g1, 'e2000000-0000-0000-0000-00000000000c'), (g1, 'e2000000-0000-0000-0000-00000000000d'),
    (g2, 'e2000000-0000-0000-0000-00000000000a'), (g2, 'e2000000-0000-0000-0000-00000000000b'),
    (g2, 'e2000000-0000-0000-0000-00000000000e')
  on conflict do nothing;
  perform set_config('z.lg1', g1::text, false);
  perform set_config('z.lg2', g2::text, false);
  insert into public.mj_scores (group_id, user_id, total, games, wins) values
    (g1, 'e2000000-0000-0000-0000-00000000000a', 10, 3, 2),
    (g1, 'e2000000-0000-0000-0000-00000000000b', -4, 3, 1),
    (g1, 'e2000000-0000-0000-0000-00000000000c', 7, 2, 1),
    (g2, 'e2000000-0000-0000-0000-00000000000a', -3, 1, 0),
    (g2, 'e2000000-0000-0000-0000-00000000000b', 2, 2, 1),
    (g2, 'e2000000-0000-0000-0000-00000000000e', 12, 9, 5);
  insert into public.mj_scores (dm_lo, dm_hi, user_id, total, games, wins) values
    ('e2000000-0000-0000-0000-00000000000a', 'e2000000-0000-0000-0000-00000000000b', 'e2000000-0000-0000-0000-00000000000a', 5, 2, 1),
    ('e2000000-0000-0000-0000-00000000000a', 'e2000000-0000-0000-0000-00000000000b', 'e2000000-0000-0000-0000-00000000000b', -5, 2, 1),
    ('e2000000-0000-0000-0000-00000000000b', 'e2000000-0000-0000-0000-00000000000c', 'e2000000-0000-0000-0000-00000000000b', 20, 4, 3),
    ('e2000000-0000-0000-0000-00000000000b', 'e2000000-0000-0000-0000-00000000000c', 'e2000000-0000-0000-0000-00000000000c', -20, 4, 1);
end $$;
create function pg_temp.line(q text) returns text language plpgsql as $$
declare r text;
begin
  execute 'select string_agg(right(user_id::text, 1) || '':'' || total || ''/'' || wins || ''/'' || games, '','') from (' || q || ') x' into r;
  return r;
end $$;
call pg_temp.as_anon();
call pg_temp.expect($$select * from public.mj_leaderboard()$$, 'permission denied for function mj_leaderboard');
reset role;
select set_config('request.jwt.claims', '', false);
select set_config('role', 'authenticated', false);
call pg_temp.expect($$select * from public.mj_leaderboard()$$, 'not_authenticated');
-- 好友榜（me）：bob = -4 + 2 - 5 + 20 = 13 积分 6 胜 11 局；erin 12 积分 5 胜 9 局；me = 10 - 3 + 5 = 12 积分 3 胜 6 局（同分，胜场少排在 erin 后面）
call pg_temp.as_user('e2000000-0000-0000-0000-00000000000a');
do $$
declare got text;
begin
  got := pg_temp.line('select * from public.mj_leaderboard()');
  if got <> 'b:13/6/11,e:12/5/9,a:12/3/6' then raise exception 'friends board wrong: %', got; end if;
  got := pg_temp.line('select * from public.mj_leaderboard(' || current_setting('z.lg1') || ')');
  if got <> 'a:10/2/3,c:7/1/2,b:-4/1/3' then raise exception 'group 1 board wrong: %', got; end if;
  got := pg_temp.line('select * from public.mj_leaderboard(' || current_setting('z.lg2') || ')');
  if got <> 'e:12/5/9,b:2/1/2,a:-3/0/1' then raise exception 'group 2 board wrong: %', got; end if;
end $$;
call pg_temp.expect($$select * from public.mj_leaderboard(999999999)$$, 'not_group_member');
call pg_temp.as_user('e2000000-0000-0000-0000-00000000000c');
call pg_temp.expect($$select * from public.mj_leaderboard(current_setting('z.lg2')::bigint)$$, 'not_group_member');
do $$
declare got text;
begin
  got := pg_temp.line('select * from public.mj_leaderboard()');
  if got <> 'b:13/6/11,c:-13/2/6' then raise exception 'carol friends board wrong: %', got; end if;
end $$;
call pg_temp.as_user('e2000000-0000-0000-0000-00000000000d');
do $$
declare got text;
begin
  got := pg_temp.line('select * from public.mj_leaderboard()');
  if got <> 'a:12/3/6,d:0/0/0' then raise exception 'dan board wrong: %', got; end if;
end $$;
call pg_temp.as_user('e2000000-0000-0000-0000-00000000000f');
do $$
declare got text;
begin
  got := pg_temp.line('select * from public.mj_leaderboard()');
  if got <> 'f:0/0/0' then raise exception 'gus board wrong: %', got; end if;
end $$;

reset role;
delete from auth.users where email like '%@mj-test.local';
select 'mahjong tests ok';
