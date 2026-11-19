-- 斗地主：开桌 / 入座 / 离座 / 机器人 / 非成员 / 一群一桌 / 手牌和完整状态的可见性 / 成员离开时的座位 / 原子提交，CI 在临时 Postgres 上运行
\set ON_ERROR_STOP on
\set QUIET on

delete from auth.users where email like '%@ddz-test.local';

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
  ('d9000000-0000-0000-0000-00000000000a', 'dz_alice@ddz-test.local'),
  ('d9000000-0000-0000-0000-00000000000b', 'dz_bob@ddz-test.local'),
  ('d9000000-0000-0000-0000-00000000000c', 'dz_carol@ddz-test.local'),
  ('d9000000-0000-0000-0000-00000000000d', 'dz_dave@ddz-test.local'),
  ('d9000000-0000-0000-0000-00000000000e', 'dz_eve@ddz-test.local');

insert into public.friendships (requester_id, addressee_id, status) values
  ('d9000000-0000-0000-0000-00000000000a', 'd9000000-0000-0000-0000-00000000000b', 'accepted'),
  ('d9000000-0000-0000-0000-00000000000a', 'd9000000-0000-0000-0000-00000000000c', 'accepted'),
  ('d9000000-0000-0000-0000-00000000000a', 'd9000000-0000-0000-0000-00000000000d', 'accepted');

-- 群 1：alice(群主) bob carol dave，开着两个助手；eve 不在任何群里
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000a');
do $$
declare g public.groups;
begin
  g := public.create_group('牌友', array['d9000000-0000-0000-0000-00000000000b','d9000000-0000-0000-0000-00000000000c','d9000000-0000-0000-0000-00000000000d']::uuid[]);
  perform set_config('ddz.g', g.id::text, false);
  perform public.set_group_agents(g.id, array['durian', 'ye_ying']);
  g := public.create_group('另一个群', array['d9000000-0000-0000-0000-00000000000b']::uuid[]);
  perform set_config('ddz.g2', g.id::text, false);
end $$;

-- ===== 权限：anon 不能调用；非成员不能开桌 =====
call pg_temp.as_anon();
call pg_temp.expect($$select public.ddz_open(current_setting('ddz.g')::bigint)$$, 'permission denied for function ddz_open');
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000e');
call pg_temp.expect($$select public.ddz_open(current_setting('ddz.g')::bigint)$$, 'not_group_member');
call pg_temp.expect($$select public.ddz_open(999999)$$, 'not_group_member');
-- 内部函数和提交函数用户不能直接调用
call pg_temp.expect($$select public.ddz_lock_waiting(1, false)$$, 'permission denied for function ddz_lock_waiting');
call pg_temp.expect($$select public.ddz_commit(1, 1, '{}', '{}', '[]', '[]', null, null)$$, 'permission denied for function ddz_commit');

-- ===== 开桌：开桌的人坐 0 号位、群里多一张 [斗地主]#id 卡片（以他的身份）；再开就是同一张 =====
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000b');
do $$
declare t public.ddz_games; t2 public.ddz_games; n int; m public.messages;
begin
  t := public.ddz_open(current_setting('ddz.g')::bigint);
  perform set_config('ddz.t', t.id::text, false);
  if t.status <> 'waiting' or t.seats <> array['d9000000-0000-0000-0000-00000000000b', null, null, null]::uuid[] or t.bots <> array[false,false,false,false] then
    raise exception 'bad new table: %', row_to_json(t);
  end if;
  select * into m from public.messages where id = t.message_id;
  if m.body <> '[斗地主]#' || t.id or m.sender_id <> 'd9000000-0000-0000-0000-00000000000b' or m.group_id <> t.group_id or m.author is not null then
    raise exception 'bad invite message: %', row_to_json(m);
  end if;
  t2 := public.ddz_open(current_setting('ddz.g')::bigint);
  if t2.id <> t.id then raise exception 'second open must return the same table'; end if;
  select count(*) into n from public.messages where group_id = t.group_id and body like '[斗地主]#%';
  if n <> 1 then raise exception 'only one invite card expected, got %', n; end if;
  -- 别的群可以有自己的桌子
  t2 := public.ddz_open(current_setting('ddz.g2')::bigint);
  if t2.id = t.id then raise exception 'other group needs its own table'; end if;
end $$;

-- 一群一桌：唯一索引兜底（直接插入第二张没结束的桌子会失败）
call pg_temp.as_admin();
call pg_temp.expect($$insert into public.ddz_games (group_id, created_by) values (current_setting('ddz.g')::bigint, null)$$,
  'duplicate key value violates unique constraint "ddz_games_one_open"');

-- ===== 入座 / 换座 / 座位被占 / 非成员 =====
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000c');
call pg_temp.expect($$select public.ddz_sit(current_setting('ddz.t')::bigint, 0)$$, 'seat_taken');
call pg_temp.expect($$select public.ddz_sit(current_setting('ddz.t')::bigint, 4)$$, 'invalid_seat');
call pg_temp.expect($$select public.ddz_sit(current_setting('ddz.t')::bigint, -1)$$, 'invalid_seat');
call pg_temp.expect($$select public.ddz_sit(999999, 1)$$, 'table_not_found');
do $$
declare t public.ddz_games;
begin
  t := public.ddz_sit(current_setting('ddz.t')::bigint, 1);
  if t.seats[2] <> 'd9000000-0000-0000-0000-00000000000c' then raise exception 'carol should sit at seat 1'; end if;
  t := public.ddz_sit(current_setting('ddz.t')::bigint, 2); -- 换座：原来的座位空出来
  if t.seats[2] is not null or t.seats[3] <> 'd9000000-0000-0000-0000-00000000000c' then raise exception 'carol should have moved to seat 2: %', row_to_json(t); end if;
end $$;
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000e');
call pg_temp.expect($$select public.ddz_sit(current_setting('ddz.t')::bigint, 1)$$, 'not_group_member');
call pg_temp.expect($$select public.ddz_stand(current_setting('ddz.t')::bigint)$$, 'not_group_member');
call pg_temp.expect($$select public.ddz_set_bot(current_setting('ddz.t')::bigint, 1, true)$$, 'not_group_member');
-- 另一个群的成员（只在群 2）：不能碰群 1 的桌子
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000b');
-- dave 在群 1，但还没坐下：不能加机器人 / 离座
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000d');
call pg_temp.expect($$select public.ddz_set_bot(current_setting('ddz.t')::bigint, 1, true)$$, 'not_seated');
call pg_temp.expect($$select public.ddz_stand(current_setting('ddz.t')::bigint)$$, 'not_seated');

-- ===== 机器人：加在空座位、不能加在有人 / 有机器人的座位、任何坐着的人都能移除 =====
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000b');
call pg_temp.expect($$select public.ddz_set_bot(current_setting('ddz.t')::bigint, 0, true)$$, 'seat_taken');
call pg_temp.expect($$select public.ddz_set_bot(current_setting('ddz.t')::bigint, 1, false)$$, 'not_a_bot');
do $$
declare t public.ddz_games;
begin
  t := public.ddz_set_bot(current_setting('ddz.t')::bigint, 1, true);
  if t.bots <> array[false, true, false, false] then raise exception 'bot not added: %', row_to_json(t); end if;
end $$;
call pg_temp.expect($$select public.ddz_set_bot(current_setting('ddz.t')::bigint, 1, true)$$, 'seat_taken');
call pg_temp.expect($$select public.ddz_sit(current_setting('ddz.t')::bigint, 1)$$, 'seat_taken'); -- 机器人占着，不能坐
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000c');
do $$
declare t public.ddz_games;
begin
  t := public.ddz_set_bot(current_setting('ddz.t')::bigint, 1, false); -- carol 移除 bob 加的机器人
  if t.bots <> array[false, false, false, false] then raise exception 'bot not removed'; end if;
  t := public.ddz_set_bot(current_setting('ddz.t')::bigint, 1, true);
end $$;

-- ===== 离座 =====
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000c');
do $$
declare t public.ddz_games;
begin
  t := public.ddz_stand(current_setting('ddz.t')::bigint);
  if t.seats[3] is not null or t.status <> 'waiting' then raise exception 'carol should have stood up: %', row_to_json(t); end if;
  if t.version < 4 then raise exception 'version must grow on each change, got %', t.version; end if;
end $$;
call pg_temp.expect($$select public.ddz_stand(current_setting('ddz.t')::bigint)$$, 'not_seated');
-- 旁观的人（群成员）能读牌桌
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000d');
do $$
begin
  if (select count(*) from public.ddz_games where id = current_setting('ddz.t')::bigint) <> 1 then raise exception 'spectator member must see the table'; end if;
end $$;
-- 非成员（eve）和 anon 看不到
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000e');
do $$
begin
  if (select count(*) from public.ddz_games) <> 0 then raise exception 'non-member must not see tables'; end if;
end $$;
call pg_temp.as_anon();
do $$
begin
  if (select count(*) from public.ddz_games) <> 0 then raise exception 'anon must not see tables'; end if;
end $$;
-- 用户不能直接写表
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000b');
call pg_temp.expect($$update public.ddz_games set status = 'over'$$, 'permission denied for table ddz_games');
call pg_temp.expect($$insert into public.ddz_scores (group_id, user_id) values (1, 'd9000000-0000-0000-0000-00000000000b')$$, 'permission denied for table ddz_scores');

-- ===== 开局（模拟 Edge Function）：用 service role 的路径 ddz_commit 原子写 =====
-- bob 坐 0，carol 坐 2，机器人在 1
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000c');
call pg_temp.expect($$select public.ddz_sit(current_setting('ddz.t')::bigint, 2)$$, 'ok');
call pg_temp.as_admin();
do $$
declare v int; ok boolean;
begin
  select version into v from public.ddz_games where id = current_setting('ddz.t')::bigint;
  -- 过期的 version：返回 false，什么都不改
  ok := public.ddz_commit(current_setting('ddz.t')::bigint, v - 1, '{"status":"bidding","pub":{"x":1}}', '{"secret":1}', '[]', '[]', null, null);
  if ok then raise exception 'stale version must not commit'; end if;
  if (select status from public.ddz_games where id = current_setting('ddz.t')::bigint) <> 'waiting' then raise exception 'stale commit changed the table'; end if;
  if exists (select 1 from public.ddz_state where game_id = current_setting('ddz.t')::bigint) then raise exception 'stale commit wrote state'; end if;
  ok := public.ddz_commit(current_setting('ddz.t')::bigint, v,
    '{"status":"bidding","pub":{"x":1},"auto":[false,false,false,false],"round":1,"deadline":"2030-01-01T00:00:00Z"}',
    '{"secret":"all hands"}',
    '[{"seat":0,"user_id":"d9000000-0000-0000-0000-00000000000b","round":1,"cards":[1,2,3]},{"seat":2,"user_id":"d9000000-0000-0000-0000-00000000000c","round":1,"cards":[7,8,9]}]',
    '[]', null, null);
  if not ok then raise exception 'commit should succeed'; end if;
  if (select version from public.ddz_games where id = current_setting('ddz.t')::bigint) <> v + 1 then raise exception 'version should grow'; end if;
end $$;

-- ===== 手牌只有本人能读；旁观者、别的座位、非成员都看不到 =====
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000b');
do $$
begin
  if (select count(*) from public.ddz_hands) <> 1 or (select cards from public.ddz_hands) <> '{1,2,3}' then raise exception 'bob sees only his own hand'; end if;
end $$;
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000c');
do $$
begin
  if (select count(*) from public.ddz_hands) <> 1 or (select cards from public.ddz_hands) <> '{7,8,9}' then raise exception 'carol sees only her own hand'; end if;
end $$;
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000d'); -- 旁观的群成员
do $$
begin
  if (select count(*) from public.ddz_hands) <> 0 then raise exception 'spectator must see no hands'; end if;
  if (select pub from public.ddz_games where id = current_setting('ddz.t')::bigint) <> '{"x":1}' then raise exception 'spectator reads pub'; end if;
end $$;
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000e');
do $$
begin
  if (select count(*) from public.ddz_hands) <> 0 then raise exception 'outsider must see no hands'; end if;
end $$;

-- ===== ddz_state：谁也读不了 =====
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000b');
call pg_temp.expect($$select * from public.ddz_state$$, 'permission denied for table ddz_state');
call pg_temp.expect($$update public.ddz_state set state = '{}'$$, 'permission denied for table ddz_state');
call pg_temp.expect($$select * from public.ddz_hands where false$$, 'ok');
call pg_temp.as_anon();
do $$
declare n int;
begin
  begin
    select count(*) into n from public.ddz_state; -- 云端 / 本地对 anon 的默认授权不同：要么没权限，要么被 RLS 挡成 0 行
    if n <> 0 then raise exception 'anon must not read ddz_state'; end if;
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- ===== 对局开始之后：不能再入座 / 离座 / 加机器人 =====
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000d');
call pg_temp.expect($$select public.ddz_sit(current_setting('ddz.t')::bigint, 1)$$, 'table_not_waiting');
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000b');
call pg_temp.expect($$select public.ddz_stand(current_setting('ddz.t')::bigint)$$, 'table_not_waiting');
call pg_temp.expect($$select public.ddz_set_bot(current_setting('ddz.t')::bigint, 1, false)$$, 'table_not_waiting');
-- 一群一桌：对局中再开桌拿到的还是这一张，不会多出卡片
do $$
declare t public.ddz_games; n int;
begin
  t := public.ddz_open(current_setting('ddz.g')::bigint);
  if t.id <> current_setting('ddz.t')::bigint then raise exception 'open during a game must return the running table'; end if;
  select count(*) into n from public.messages where group_id = t.group_id and body like '[斗地主]#%';
  if n <> 1 then raise exception 'no second card'; end if;
end $$;

-- ===== 对局结束：积分、系统提示行、结束后可以另开一桌 =====
call pg_temp.as_admin();
do $$
declare v int; ok boolean; line text;
begin
  select version into v from public.ddz_games where id = current_setting('ddz.t')::bigint;
  ok := public.ddz_commit(current_setting('ddz.t')::bigint, v, '{"status":"over","pub":{"over":true},"deadline":null}', '{"secret":2}', '[]',
    '[{"user_id":"d9000000-0000-0000-0000-00000000000b","delta":6,"win":true},{"user_id":"d9000000-0000-0000-0000-00000000000c","delta":-3,"win":false}]',
    '斗地主：地主 dz_bob 赢了，3 倍', 'd9000000-0000-0000-0000-00000000000b');
  if not ok then raise exception 'finish commit'; end if;
  -- 再提交一次积分是累加
  select version into v from public.ddz_games where id = current_setting('ddz.t')::bigint;
  perform public.ddz_commit(current_setting('ddz.t')::bigint, v, '{"status":"over","pub":{"over":true},"deadline":null}', '{"secret":3}', '[]',
    '[{"user_id":"d9000000-0000-0000-0000-00000000000b","delta":-2,"win":false}]', null, null);
  select body into line from public.messages where group_id = (select group_id from public.ddz_games where id = current_setting('ddz.t')::bigint) and author = 'system' order by id desc limit 1;
  if line <> '斗地主：地主 dz_bob 赢了，3 倍' then raise exception 'system line missing: %', line; end if;
end $$;
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000d'); -- 旁观的群成员读得到积分
do $$
declare r public.ddz_scores;
begin
  select * into r from public.ddz_scores where user_id = 'd9000000-0000-0000-0000-00000000000b' and group_id = current_setting('ddz.g')::bigint;
  if r.total <> 4 or r.games <> 2 or r.wins <> 1 then raise exception 'bad score row: %', row_to_json(r); end if;
end $$;
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000e');
do $$ begin if (select count(*) from public.ddz_scores) <> 0 then raise exception 'outsider must not read scores'; end if; end $$;

-- 结束的桌子不挡着开新桌
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000d');
do $$
declare t public.ddz_games;
begin
  t := public.ddz_open(current_setting('ddz.g')::bigint);
  if t.id = current_setting('ddz.t')::bigint or t.status <> 'waiting' or t.seats[1] <> 'd9000000-0000-0000-0000-00000000000d' then raise exception 'new table after over: %', row_to_json(t); end if;
  perform set_config('ddz.t2', t.id::text, false);
end $$;
-- 结束的桌子不能再入座
call pg_temp.expect($$select public.ddz_sit(current_setting('ddz.t')::bigint, 1)$$, 'table_not_waiting');
-- 最后一个真人离座：桌子关闭，之后可以重新开
do $$
declare t public.ddz_games;
begin
  t := public.ddz_stand(current_setting('ddz.t2')::bigint);
  if t.status <> 'closed' then raise exception 'last human standing closes the table'; end if;
  t := public.ddz_open(current_setting('ddz.g')::bigint);
  if t.status <> 'waiting' or t.id = current_setting('ddz.t2')::bigint then raise exception 'reopen after close'; end if;
  perform set_config('ddz.t3', t.id::text, false);
end $$;

-- ===== 成员离开 / 被移出：等人时座位空出来；对局中变成永久托管；手牌行删掉 =====
-- 等人：dave 开的 t3，让 carol 也坐下，然后 carol 退群
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000c');
call pg_temp.expect($$select public.ddz_sit(current_setting('ddz.t3')::bigint, 2)$$, 'ok');
call pg_temp.expect($$select public.leave_group(current_setting('ddz.g')::bigint)$$, 'ok');
call pg_temp.as_admin();
do $$
declare t public.ddz_games;
begin
  select * into t from public.ddz_games where id = current_setting('ddz.t3')::bigint;
  if t.seats[3] is not null or t.status <> 'waiting' or t.bots <> array[false,false,false,false] then raise exception 'waiting seat should be freed: %', row_to_json(t); end if;
  if t.seats[1] <> 'd9000000-0000-0000-0000-00000000000d' then raise exception 'dave keeps his seat'; end if;
end $$;

-- 对局中：把 t3 推进到 bidding，bob（被群主移出）坐着，dave 也坐着
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000b');
call pg_temp.expect($$select public.ddz_sit(current_setting('ddz.t3')::bigint, 1)$$, 'ok');
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000d');
call pg_temp.expect($$select public.ddz_set_bot(current_setting('ddz.t3')::bigint, 2, true)$$, 'ok');
call pg_temp.as_admin();
do $$
declare v int; ok boolean;
begin
  select version into v from public.ddz_games where id = current_setting('ddz.t3')::bigint;
  ok := public.ddz_commit(current_setting('ddz.t3')::bigint, v,
    '{"status":"playing","pub":{},"auto":[false,false,false,false],"round":1,"deadline":"2030-01-01T00:00:00Z"}', '{"s":1}',
    '[{"seat":0,"user_id":"d9000000-0000-0000-0000-00000000000d","round":1,"cards":[1]},{"seat":1,"user_id":"d9000000-0000-0000-0000-00000000000b","round":1,"cards":[2]}]', '[]', null, null);
  if not ok then raise exception 'commit t3'; end if;
end $$;
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000a'); -- 群主移出 bob
call pg_temp.expect($$select public.remove_group_member(current_setting('ddz.g')::bigint, 'd9000000-0000-0000-0000-00000000000b')$$, 'ok');
call pg_temp.as_admin();
do $$
declare t public.ddz_games;
begin
  select * into t from public.ddz_games where id = current_setting('ddz.t3')::bigint;
  if t.status <> 'playing' or t.seats[2] is not null or t.bots[2] is not true or t.auto[2] is not true then raise exception 'removed player should be on permanent auto: %', row_to_json(t); end if;
  if t.seats[1] <> 'd9000000-0000-0000-0000-00000000000d' or t.auto[1] then raise exception 'other humans untouched'; end if;
  if exists (select 1 from public.ddz_hands where game_id = t.id and user_id = 'd9000000-0000-0000-0000-00000000000b') then raise exception 'removed member hand row must be deleted'; end if;
  if not exists (select 1 from public.ddz_hands where game_id = t.id and user_id = 'd9000000-0000-0000-0000-00000000000d') then raise exception 'other hands stay'; end if;
end $$;
-- 最后一个真人也走了：桌子关闭
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000d');
call pg_temp.expect($$select public.leave_group(current_setting('ddz.g')::bigint)$$, 'ok');
call pg_temp.as_admin();
do $$
declare t public.ddz_games;
begin
  select * into t from public.ddz_games where id = current_setting('ddz.t3')::bigint;
  if t.status <> 'closed' or t.deadline is not null then raise exception 'no humans left closes the table: %', row_to_json(t); end if;
end $$;
-- 群没了（alice 是最后一个人，退群 = 删群）：牌桌跟着级联删除，不报错
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000a');
call pg_temp.expect($$select public.leave_group(current_setting('ddz.g')::bigint)$$, 'ok');
call pg_temp.as_admin();
do $$
begin
  if exists (select 1 from public.ddz_games where group_id = current_setting('ddz.g')::bigint) then raise exception 'tables must cascade with the group'; end if;
end $$;

-- 清理
delete from auth.users where email like '%@ddz-test.local';
do $$ begin
  if exists (select 1 from public.ddz_games g where not exists (select 1 from public.groups x where x.id = g.group_id)) then raise exception 'orphans'; end if;
end $$;
select 'doudizhu ok';
