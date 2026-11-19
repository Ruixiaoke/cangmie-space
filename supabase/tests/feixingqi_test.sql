-- 飞行棋：群桌 / 私聊桌的开桌、座位、机器人、权限（RLS）、原子提交（版本、积分、系统提示行）、成员离开 / 好友关系结束、排行榜，CI 在临时 Postgres 上运行
\set ON_ERROR_STOP on
\set QUIET on

delete from auth.users where email like '%@fxq-test.local';

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
  ('f6000000-0000-0000-0000-00000000000a', 'a_amy@fxq-test.local'),
  ('f6000000-0000-0000-0000-00000000000b', 'b_ben@fxq-test.local'),
  ('f6000000-0000-0000-0000-00000000000c', 'c_cat@fxq-test.local'),
  ('f6000000-0000-0000-0000-00000000000d', 'd_dan@fxq-test.local'),
  ('f6000000-0000-0000-0000-00000000000e', 'e_eve@fxq-test.local');

-- amy 和 ben、cat、dan 都是好友（ben、cat、dan 之间不是好友）；eve 谁也不认识
insert into public.friendships (requester_id, addressee_id, status) values
  ('f6000000-0000-0000-0000-00000000000a', 'f6000000-0000-0000-0000-00000000000b', 'accepted'),
  ('f6000000-0000-0000-0000-00000000000a', 'f6000000-0000-0000-0000-00000000000c', 'accepted'),
  ('f6000000-0000-0000-0000-00000000000d', 'f6000000-0000-0000-0000-00000000000a', 'accepted');

call pg_temp.as_user('f6000000-0000-0000-0000-00000000000a');
do $$
declare g public.groups;
begin
  g := public.create_group('飞行棋群', array['f6000000-0000-0000-0000-00000000000b','f6000000-0000-0000-0000-00000000000c','f6000000-0000-0000-0000-00000000000d']::uuid[]);
  perform set_config('fx.g', g.id::text, false);
  g := public.create_group('另一个群', array['f6000000-0000-0000-0000-00000000000b']::uuid[]);
  perform set_config('fx.g2', g.id::text, false);
end $$;

-- ===== 权限：anon / 非成员不能开桌；内部函数和提交函数用户不能直接调用 =====
call pg_temp.as_anon();
call pg_temp.expect($$select public.fxq_open(current_setting('fx.g')::bigint)$$, 'permission denied for function fxq_open');
call pg_temp.expect($$select public.fxq_open_dm('f6000000-0000-0000-0000-00000000000b')$$, 'permission denied for function fxq_open_dm');
call pg_temp.expect($$select public.fxq_leaderboard(null)$$, 'permission denied for function fxq_leaderboard');
call pg_temp.as_user('f6000000-0000-0000-0000-00000000000e');
call pg_temp.expect($$select public.fxq_open(current_setting('fx.g')::bigint)$$, 'not_group_member');
call pg_temp.expect($$select public.fxq_open(999999)$$, 'not_group_member');
call pg_temp.expect($$select public.fxq_lock_waiting(1, false)$$, 'permission denied for function fxq_lock_waiting');
call pg_temp.expect($$select public.fxq_commit(1, 1, '{}', '[]', null, null)$$, 'permission denied for function fxq_commit');

-- ===== 群里开桌：开桌的人坐 0 号位（红），群里多一张 [飞行棋]#id 卡片；再开就是同一张 =====
call pg_temp.as_user('f6000000-0000-0000-0000-00000000000b');
do $$
declare t public.fxq_games; t2 public.fxq_games; n int; m public.messages;
begin
  t := public.fxq_open(current_setting('fx.g')::bigint);
  perform set_config('fx.t', t.id::text, false);
  if t.status <> 'waiting' or t.seats <> array['f6000000-0000-0000-0000-00000000000b', null, null, null]::uuid[] or t.bots <> array[false,false,false,false] or t.dm_lo is not null then
    raise exception 'bad new table: %', row_to_json(t);
  end if;
  select * into m from public.messages where id = t.message_id;
  if m.body <> '[飞行棋]#' || t.id or m.sender_id <> 'f6000000-0000-0000-0000-00000000000b' or m.group_id <> t.group_id or m.author is not null then
    raise exception 'bad invite message: %', row_to_json(m);
  end if;
  t2 := public.fxq_open(current_setting('fx.g')::bigint);
  if t2.id <> t.id then raise exception 'second open must return the same table'; end if;
  select count(*) into n from public.messages where group_id = t.group_id and body like '[飞行棋]#%';
  if n <> 1 then raise exception 'only one invite card expected, got %', n; end if;
  t2 := public.fxq_open(current_setting('fx.g2')::bigint);
  if t2.id = t.id then raise exception 'other group needs its own table'; end if;
end $$;
-- 一群一桌：唯一索引兜底
call pg_temp.as_admin();
call pg_temp.expect($$insert into public.fxq_games (group_id, created_by) values (current_setting('fx.g')::bigint, null)$$,
  'duplicate key value violates unique constraint "fxq_games_one_open"');
-- 状态和目标约束
call pg_temp.expect($$update public.fxq_games set status = 'bidding' where id = current_setting('fx.t')::bigint$$,
  'new row for relation "fxq_games" violates check constraint "fxq_games_status_valid"');
call pg_temp.expect($$insert into public.fxq_games (group_id, dm_lo, dm_hi) values (null, null, null)$$,
  'new row for relation "fxq_games" violates check constraint "fxq_games_target_one"');

-- ===== 入座 / 换座 / 座位被占 / 非成员 =====
call pg_temp.as_user('f6000000-0000-0000-0000-00000000000c');
call pg_temp.expect($$select public.fxq_sit(current_setting('fx.t')::bigint, 0)$$, 'seat_taken');
call pg_temp.expect($$select public.fxq_sit(current_setting('fx.t')::bigint, 4)$$, 'invalid_seat');
call pg_temp.expect($$select public.fxq_sit(current_setting('fx.t')::bigint, -1)$$, 'invalid_seat');
call pg_temp.expect($$select public.fxq_sit(999999, 1)$$, 'table_not_found');
do $$
declare t public.fxq_games;
begin
  t := public.fxq_sit(current_setting('fx.t')::bigint, 1);
  if t.seats[2] <> 'f6000000-0000-0000-0000-00000000000c' then raise exception 'cat should sit at seat 1'; end if;
  t := public.fxq_sit(current_setting('fx.t')::bigint, 3); -- 换座：原来的座位空出来；座位 3 = 绿
  if t.seats[2] is not null or t.seats[4] <> 'f6000000-0000-0000-0000-00000000000c' then raise exception 'cat should have moved to seat 3: %', row_to_json(t); end if;
  t := public.fxq_sit(current_setting('fx.t')::bigint, 3); -- 本来就坐在这里
end $$;
call pg_temp.as_user('f6000000-0000-0000-0000-00000000000e');
call pg_temp.expect($$select public.fxq_sit(current_setting('fx.t')::bigint, 1)$$, 'not_group_member');
call pg_temp.expect($$select public.fxq_stand(current_setting('fx.t')::bigint)$$, 'not_group_member');
call pg_temp.expect($$select public.fxq_set_bot(current_setting('fx.t')::bigint, 1, true)$$, 'not_group_member');
call pg_temp.as_user('f6000000-0000-0000-0000-00000000000d');
call pg_temp.expect($$select public.fxq_set_bot(current_setting('fx.t')::bigint, 1, true)$$, 'not_seated');
call pg_temp.expect($$select public.fxq_stand(current_setting('fx.t')::bigint)$$, 'not_seated');

-- ===== 机器人 =====
call pg_temp.as_user('f6000000-0000-0000-0000-00000000000b');
call pg_temp.expect($$select public.fxq_set_bot(current_setting('fx.t')::bigint, 0, true)$$, 'seat_taken');
call pg_temp.expect($$select public.fxq_set_bot(current_setting('fx.t')::bigint, 1, false)$$, 'not_a_bot');
call pg_temp.expect($$select public.fxq_set_bot(current_setting('fx.t')::bigint, 4, true)$$, 'invalid_seat');
do $$
declare t public.fxq_games;
begin
  t := public.fxq_set_bot(current_setting('fx.t')::bigint, 1, true);
  if t.bots <> array[false, true, false, false] then raise exception 'bot not added: %', row_to_json(t); end if;
end $$;
call pg_temp.expect($$select public.fxq_set_bot(current_setting('fx.t')::bigint, 1, true)$$, 'seat_taken');
call pg_temp.expect($$select public.fxq_sit(current_setting('fx.t')::bigint, 1)$$, 'seat_taken');
call pg_temp.as_user('f6000000-0000-0000-0000-00000000000c');
do $$
declare t public.fxq_games;
begin
  t := public.fxq_set_bot(current_setting('fx.t')::bigint, 1, false); -- 任何坐着的人都能移除机器人
  if t.bots <> array[false, false, false, false] then raise exception 'bot not removed'; end if;
  t := public.fxq_set_bot(current_setting('fx.t')::bigint, 2, true);
end $$;

-- ===== 离座：最后一个真人离开就关桌 =====
do $$
declare t public.fxq_games;
begin
  t := public.fxq_stand(current_setting('fx.t')::bigint);
  if t.seats[4] is not null or t.status <> 'waiting' then raise exception 'cat should have stood up: %', row_to_json(t); end if;
  if t.version < 5 then raise exception 'version must grow on each change, got %', t.version; end if;
end $$;
call pg_temp.expect($$select public.fxq_stand(current_setting('fx.t')::bigint)$$, 'not_seated');

-- ===== RLS =====
call pg_temp.as_user('f6000000-0000-0000-0000-00000000000d');
do $$
begin
  if (select count(*) from public.fxq_games where id = current_setting('fx.t')::bigint) <> 1 then raise exception 'a group member must see the table'; end if;
end $$;
call pg_temp.as_user('f6000000-0000-0000-0000-00000000000e');
do $$
begin
  if (select count(*) from public.fxq_games) <> 0 then raise exception 'non-member must not see tables'; end if;
  if (select count(*) from public.fxq_scores) <> 0 then raise exception 'non-member must not see scores'; end if;
end $$;
call pg_temp.as_anon();
do $$
begin
  if (select count(*) from public.fxq_games) <> 0 then raise exception 'anon must not see tables'; end if;
end $$;
call pg_temp.as_user('f6000000-0000-0000-0000-00000000000b');
call pg_temp.expect($$update public.fxq_games set status = 'over'$$, 'permission denied for table fxq_games');
call pg_temp.expect($$insert into public.fxq_scores (group_id, user_id, wins, games) values (1, 'f6000000-0000-0000-0000-00000000000b', 9, 9)$$, 'permission denied for table fxq_scores');

-- ===== 开局与结算（模拟 Edge Function 的原子提交）=====
call pg_temp.as_user('f6000000-0000-0000-0000-00000000000c');
call pg_temp.expect($$select public.fxq_sit(current_setting('fx.t')::bigint, 1)$$, 'ok');
call pg_temp.as_admin();
do $$
declare v int; ok boolean; t public.fxq_games; n int;
begin
  select version into v from public.fxq_games where id = current_setting('fx.t')::bigint;
  ok := public.fxq_commit(current_setting('fx.t')::bigint, v - 1, '{"status":"playing","pub":{"x":1}}', '[]', null, null);
  if ok then raise exception 'stale version must not commit'; end if;
  if (select status from public.fxq_games where id = current_setting('fx.t')::bigint) <> 'waiting' then raise exception 'stale commit changed the table'; end if;
  ok := public.fxq_commit(current_setting('fx.t')::bigint, v,
    '{"status":"playing","pub":{"x":1},"auto":[false,false,false,false],"round":1,"deadline":"2030-01-01T00:00:00Z"}', '[]', null, null);
  if not ok then raise exception 'fresh version must commit'; end if;
  select * into t from public.fxq_games where id = current_setting('fx.t')::bigint;
  if t.status <> 'playing' or t.round <> 1 or t.pub <> '{"x":1}'::jsonb or t.version <> v + 1 or t.deadline is null then raise exception 'commit not applied: %', row_to_json(t); end if;
  -- 结算：ben 赢，cat 输；系统提示行写进群里
  ok := public.fxq_commit(current_setting('fx.t')::bigint, v + 1, '{"status":"over","pub":{"x":2},"round":1}',
    '[{"user_id":"f6000000-0000-0000-0000-00000000000b","win":true},{"user_id":"f6000000-0000-0000-0000-00000000000c","win":false}]',
    '飞行棋：ben 赢了', 'f6000000-0000-0000-0000-00000000000b');
  if not ok then raise exception 'settle must commit'; end if;
  if (select deadline from public.fxq_games where id = current_setting('fx.t')::bigint) is not null then raise exception 'deadline must clear'; end if;
  select count(*) into n from public.messages where group_id = t.group_id and author = 'system' and body = '飞行棋：ben 赢了';
  if n <> 1 then raise exception 'system line missing'; end if;
  if (select wins from public.fxq_scores where group_id = t.group_id and user_id = 'f6000000-0000-0000-0000-00000000000b') <> 1 then raise exception 'ben should have 1 win'; end if;
  if (select games from public.fxq_scores where group_id = t.group_id and user_id = 'f6000000-0000-0000-0000-00000000000c') <> 1
     or (select wins from public.fxq_scores where group_id = t.group_id and user_id = 'f6000000-0000-0000-0000-00000000000c') <> 0 then raise exception 'cat should have 1 game 0 wins'; end if;
  -- 再来一局：积分累加
  ok := public.fxq_commit(current_setting('fx.t')::bigint, v + 2, '{"status":"over","pub":{"x":3},"round":2}',
    '[{"user_id":"f6000000-0000-0000-0000-00000000000b","win":true},{"user_id":"f6000000-0000-0000-0000-00000000000c","win":true}]', null, null);
  if (select wins || '/' || games from public.fxq_scores where group_id = t.group_id and user_id = 'f6000000-0000-0000-0000-00000000000b') <> '2/2' then raise exception 'ben should be 2/2'; end if;
end $$;
-- 结束的桌子不再占「一群一桌」：可以再开一张
call pg_temp.as_user('f6000000-0000-0000-0000-00000000000b');
do $$
declare t public.fxq_games;
begin
  t := public.fxq_open(current_setting('fx.g')::bigint);
  if t.id = current_setting('fx.t')::bigint then raise exception 'finished table must not be returned'; end if;
  perform set_config('fx.t2', t.id::text, false);
end $$;
-- 积分：群成员能看，非成员看不到
call pg_temp.as_user('f6000000-0000-0000-0000-00000000000d');
do $$
begin
  if (select count(*) from public.fxq_scores) <> 2 then raise exception 'members see the group scores'; end if;
end $$;

-- ===== 群成员离开 =====
-- 等人时（t2：ben 坐 0）：座位空出来，没有真人就关桌
call pg_temp.as_user('f6000000-0000-0000-0000-00000000000c');
call pg_temp.expect($$select public.fxq_sit(current_setting('fx.t2')::bigint, 1)$$, 'ok');
call pg_temp.as_admin();
do $$
declare t public.fxq_games; ok boolean;
begin
  -- 对局中：cat 离开 -> 座位变成托管的机器人
  select * into t from public.fxq_games where id = current_setting('fx.t2')::bigint;
  ok := public.fxq_commit(t.id, t.version, '{"status":"playing","pub":{"x":1},"auto":[false,false,false,false],"round":1,"deadline":"2030-01-01T00:00:00Z"}', '[]', null, null);
  delete from public.group_members where group_id = t.group_id and user_id = 'f6000000-0000-0000-0000-00000000000c';
  select * into t from public.fxq_games where id = t.id;
  if t.seats[2] is not null or not t.bots[2] or not t.auto[2] or t.status <> 'playing' then raise exception 'leaving player must become an auto bot: %', row_to_json(t); end if;
  delete from public.group_members where group_id = t.group_id and user_id = 'f6000000-0000-0000-0000-00000000000b';
  select * into t from public.fxq_games where id = t.id;
  if t.status <> 'closed' or t.deadline is not null then raise exception 'no humans left must close the table: %', row_to_json(t); end if;
end $$;

-- ===== 私聊桌 =====
call pg_temp.as_anon();
call pg_temp.expect($$select public.fxq_open_dm('f6000000-0000-0000-0000-00000000000b')$$, 'permission denied for function fxq_open_dm');
call pg_temp.as_user('f6000000-0000-0000-0000-00000000000e');
call pg_temp.expect($$select public.fxq_open_dm('f6000000-0000-0000-0000-00000000000a')$$, 'not_friends');
call pg_temp.expect($$select public.fxq_open_dm('f6000000-0000-0000-0000-00000000000e')$$, 'not_friends');
call pg_temp.expect($$select public.fxq_open_dm(null)$$, 'not_friends');
call pg_temp.as_user('f6000000-0000-0000-0000-00000000000c');
call pg_temp.expect($$select public.fxq_open_dm('f6000000-0000-0000-0000-00000000000d')$$, 'not_friends');

call pg_temp.as_user('f6000000-0000-0000-0000-00000000000a');
do $$
declare t public.fxq_games; m public.messages;
begin
  t := public.fxq_open_dm('f6000000-0000-0000-0000-00000000000b');
  perform set_config('fx.d', t.id::text, false);
  if t.group_id is not null or t.dm_lo <> least('f6000000-0000-0000-0000-00000000000a'::uuid, 'f6000000-0000-0000-0000-00000000000b'::uuid)
     or t.dm_hi <> greatest('f6000000-0000-0000-0000-00000000000a'::uuid, 'f6000000-0000-0000-0000-00000000000b'::uuid)
     or t.status <> 'waiting' or t.seats <> array['f6000000-0000-0000-0000-00000000000a', null, null, null]::uuid[] then
    raise exception 'bad dm table: %', row_to_json(t);
  end if;
  select * into m from public.messages where id = t.message_id;
  if m.body <> '[飞行棋]#' || t.id or m.sender_id <> 'f6000000-0000-0000-0000-00000000000a' or m.receiver_id <> 'f6000000-0000-0000-0000-00000000000b' or m.group_id is not null or m.author is not null then
    raise exception 'bad dm invite: %', row_to_json(m);
  end if;
end $$;
call pg_temp.as_user('f6000000-0000-0000-0000-00000000000b');
do $$
declare t public.fxq_games; n int;
begin
  t := public.fxq_open_dm('f6000000-0000-0000-0000-00000000000a');
  if t.id <> current_setting('fx.d')::bigint then raise exception 'peer must get the same table'; end if;
  select count(*) into n from public.messages where body = '[飞行棋]#' || t.id;
  if n <> 1 then raise exception 'one invite only, got %', n; end if;
  t := public.fxq_sit(t.id, 2);
  if t.seats[3] <> 'f6000000-0000-0000-0000-00000000000b' then raise exception 'ben should sit at seat 2'; end if;
  t := public.fxq_set_bot(t.id, 1, true);
end $$;
-- 私聊桌只有这两个人看得到
call pg_temp.as_user('f6000000-0000-0000-0000-00000000000c');
do $$
begin
  if exists (select 1 from public.fxq_games where id = current_setting('fx.d')::bigint) then raise exception 'a third party must not see a dm table'; end if;
end $$;
call pg_temp.expect($$select public.fxq_sit(current_setting('fx.d')::bigint, 3)$$, 'not_friends');
call pg_temp.as_user('f6000000-0000-0000-0000-00000000000a');
do $$
begin
  if not exists (select 1 from public.fxq_games where id = current_setting('fx.d')::bigint) then raise exception 'dm player must see the table'; end if;
end $$;
-- 私聊结算：积分按好友对累计，不写系统提示行
call pg_temp.as_admin();
do $$
declare t public.fxq_games; ok boolean; n0 int; n1 int;
begin
  select * into t from public.fxq_games where id = current_setting('fx.d')::bigint;
  ok := public.fxq_commit(t.id, t.version, '{"status":"playing","pub":{"x":1},"round":1,"deadline":"2030-01-01T00:00:00Z"}', '[]', null, null);
  select count(*) into n0 from public.messages where author = 'system';
  ok := public.fxq_commit(t.id, t.version + 1, '{"status":"over","pub":{"x":2},"round":1}',
    '[{"user_id":"f6000000-0000-0000-0000-00000000000a","win":true},{"user_id":"f6000000-0000-0000-0000-00000000000b","win":false}]',
    '不该出现的系统行', 'f6000000-0000-0000-0000-00000000000a');
  select count(*) into n1 from public.messages where author = 'system';
  if n1 <> n0 then raise exception 'dm must not get a system line'; end if;
  if (select wins from public.fxq_scores where dm_lo = t.dm_lo and dm_hi = t.dm_hi and user_id = 'f6000000-0000-0000-0000-00000000000a') <> 1 then raise exception 'amy dm win'; end if;
end $$;

-- ===== 好友关系结束：这一对没结束的私聊桌关闭 =====
call pg_temp.as_user('f6000000-0000-0000-0000-00000000000a');
do $$
declare t public.fxq_games;
begin
  t := public.fxq_open_dm('f6000000-0000-0000-0000-00000000000c');
  perform set_config('fx.d2', t.id::text, false);
end $$;
call pg_temp.as_admin();
delete from public.friendships where (requester_id, addressee_id) = ('f6000000-0000-0000-0000-00000000000a', 'f6000000-0000-0000-0000-00000000000c');
do $$
begin
  if (select status from public.fxq_games where id = current_setting('fx.d2')::bigint) <> 'closed' then raise exception 'unfriending must close the dm table'; end if;
end $$;

-- ===== 排行榜 =====
-- 现在：群 g 里 ben 2 胜 / 2 局，cat 1 胜 / 2 局（群行）；私聊 amy-ben：amy 1 胜 / 1 局，ben 0 胜 / 1 局
call pg_temp.as_admin();
insert into public.group_members (group_id, user_id) values (current_setting('fx.g')::bigint, 'f6000000-0000-0000-0000-00000000000b'), (current_setting('fx.g')::bigint, 'f6000000-0000-0000-0000-00000000000c') on conflict do nothing;
call pg_temp.as_user('f6000000-0000-0000-0000-00000000000a');
do $$
declare r record; s text := '';
begin
  -- 好友榜：我 + 好友（ben、dan；cat 的好友关系刚被删），把所有桌子加起来；没打过的 dan 不出现
  for r in select * from public.fxq_leaderboard(null) loop
    s := s || r.nickname || ':' || r.wins || '/' || r.games || ' ';
  end loop;
  if s <> 'b_ben:2/3 a_amy:1/1 ' then raise exception 'friends board wrong: %', s; end if;
  -- 本群榜：只算这个群的行；没打过的人（dan）不出现，只有我自己例外
  s := '';
  for r in select * from public.fxq_leaderboard(current_setting('fx.g')::bigint) loop
    s := s || r.nickname || ':' || r.wins || '/' || r.games || ' ';
  end loop;
  if s <> 'b_ben:2/2 c_cat:1/2 a_amy:0/0 ' then raise exception 'group board wrong: %', s; end if;
end $$;
call pg_temp.as_user('f6000000-0000-0000-0000-00000000000e');
call pg_temp.expect($$select * from public.fxq_leaderboard(current_setting('fx.g')::bigint)$$, 'not_group_member');
do $$
begin
  if (select count(*) from public.fxq_leaderboard(null)) <> 1 then raise exception 'eve only sees herself'; end if;
end $$;

call pg_temp.as_admin();
delete from auth.users where email like '%@fxq-test.local';
