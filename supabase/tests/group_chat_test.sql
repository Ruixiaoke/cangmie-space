-- 群聊：创建 / 成员 / 消息可见性 / 系统消息 / 群主转移 / 未读 / 助手提问 / 私聊函数不受影响，CI 在临时 Postgres 上运行
-- 自带数据：开头清理上一次的测试用户，结尾再清理
\set ON_ERROR_STOP on
\set QUIET on

delete from auth.users where email like '%@group-test.local';

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
  ('c9000000-0000-0000-0000-00000000000a', 'gp_alice@group-test.local'),
  ('c9000000-0000-0000-0000-00000000000b', 'gp_bob@group-test.local'),
  ('c9000000-0000-0000-0000-00000000000c', 'gp_carol@group-test.local'),
  ('c9000000-0000-0000-0000-00000000000d', 'gp_dave@group-test.local'),
  ('c9000000-0000-0000-0000-00000000000e', 'gp_eve@group-test.local');

-- alice 和 bob / carol / dave 是好友；bob-carol 是好友；eve 谁也不是；bob-dave 不是好友
insert into public.friendships (requester_id, addressee_id, status) values
  ('c9000000-0000-0000-0000-00000000000a', 'c9000000-0000-0000-0000-00000000000b', 'accepted'),
  ('c9000000-0000-0000-0000-00000000000a', 'c9000000-0000-0000-0000-00000000000c', 'accepted'),
  ('c9000000-0000-0000-0000-00000000000a', 'c9000000-0000-0000-0000-00000000000d', 'accepted'),
  ('c9000000-0000-0000-0000-00000000000b', 'c9000000-0000-0000-0000-00000000000c', 'accepted'),
  ('c9000000-0000-0000-0000-00000000000e', 'c9000000-0000-0000-0000-00000000000d', 'pending');

-- ===== 权限 =====
call pg_temp.as_anon();
call pg_temp.expect($$select public.create_group('x', array['c9000000-0000-0000-0000-00000000000b']::uuid[])$$, 'permission denied for function create_group');
do $$ begin
  if (select count(*) from public.groups) <> 0 or (select count(*) from public.group_members) <> 0 then raise exception 'anon must see no groups'; end if;
end $$;

-- ===== 建群：非好友 / 没人 / 名字 =====
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000a');
call pg_temp.expect($$select public.create_group('x', array['c9000000-0000-0000-0000-00000000000e']::uuid[])$$, 'not_friends');
call pg_temp.expect($$select public.create_group('x', array['c9000000-0000-0000-0000-00000000000b','c9000000-0000-0000-0000-00000000000e']::uuid[])$$, 'not_friends');
call pg_temp.expect($$select public.create_group('x', '{}'::uuid[])$$, 'invalid_members');
call pg_temp.expect($$select public.create_group('x', array['c9000000-0000-0000-0000-00000000000a']::uuid[])$$, 'invalid_members');
call pg_temp.expect($$select public.create_group(repeat('长', 21), array['c9000000-0000-0000-0000-00000000000b']::uuid[])$$, 'invalid_group_name');
call pg_temp.expect($$select public.create_group('x', null)$$, 'invalid_members');
do $$
declare g public.groups;
begin
  g := public.create_group('周末小分队', array['c9000000-0000-0000-0000-00000000000b','c9000000-0000-0000-0000-00000000000c']::uuid[]);
  perform set_config('grp.id', g.id::text, false);
  if g.owner_id <> 'c9000000-0000-0000-0000-00000000000a' or g.agents <> '{}' then raise exception 'bad group row'; end if;
  -- 默认群名：前几个昵称用、连起来，最多 20 字
  g := public.create_group('', array['c9000000-0000-0000-0000-00000000000d']::uuid[]);
  if g.name <> 'gp_dave' then raise exception 'default name should be nicknames, got %', g.name; end if;
  perform set_config('grp.solo', g.id::text, false);
end $$;
do $$
declare n int; body text;
begin
  select count(*) into n from public.group_members where group_id = current_setting('grp.id')::bigint;
  if n <> 3 then raise exception 'expected 3 members, got %', n; end if;
  select m.body into body from public.messages m where m.group_id = current_setting('grp.id')::bigint and m.author = 'system';
  if body <> 'gp_alice 创建了群聊' then raise exception 'bad create line: %', body; end if;
end $$;

-- ===== 消息：成员互相能看到，非成员看不到 =====
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000b');
do $$
declare m public.messages; r public.messages;
begin
  m := public.send_group_message(current_setting('grp.id')::bigint, '  大家好  ');
  if m.body <> '大家好' or m.receiver_id is not null or m.group_id <> current_setting('grp.id')::bigint or m.author is not null then raise exception 'bad group message'; end if;
  perform set_config('grp.m1', m.id::text, false);
  r := public.send_group_message(current_setting('grp.id')::bigint, '回你', m.id);
  if r.reply_to <> m.id then raise exception 'reply_to not stored'; end if;
end $$;
call pg_temp.expect($$select public.send_group_message(current_setting('grp.id')::bigint, '')$$, 'empty_message');
call pg_temp.expect($$select public.send_group_message(current_setting('grp.id')::bigint, repeat('字', 2001))$$, 'message_too_long');
call pg_temp.expect($$select public.send_group_message(999999, 'hi')$$, 'not_group_member');

call pg_temp.as_user('c9000000-0000-0000-0000-00000000000c');
do $$
declare n int;
begin
  select count(*) into n from public.messages where group_id = current_setting('grp.id')::bigint and author is null;
  if n <> 2 then raise exception 'member carol should see 2 chat messages, got %', n; end if;
  -- 同群的人能看到彼此的资料（carol 和 bob 本来就是好友；检查 alice 的昵称也在）
  if (select count(*) from public.profiles where id in ('c9000000-0000-0000-0000-00000000000a','c9000000-0000-0000-0000-00000000000b')) <> 2 then raise exception 'profiles of group mates visible'; end if;
  if (select count(*) from public.groups where id = current_setting('grp.id')::bigint) <> 1 then raise exception 'member sees the group'; end if;
  if (select count(*) from public.group_members where group_id = current_setting('grp.id')::bigint) <> 3 then raise exception 'member sees member list'; end if;
end $$;

-- 非成员：dave（不在群里）、eve
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000e');
do $$
begin
  if (select count(*) from public.messages where group_id is not null) <> 0 then raise exception 'eve must not see group messages'; end if;
  if (select count(*) from public.groups) <> 0 or (select count(*) from public.group_members) <> 0 then raise exception 'eve must not see groups'; end if;
end $$;
call pg_temp.expect(format($$select public.send_group_message(%s, 'hi')$$, current_setting('grp.id')), 'not_group_member');
call pg_temp.expect(format($$select public.mark_group_read(%s)$$, current_setting('grp.id')), 'not_group_member');
call pg_temp.expect(format($$select public.rename_group(%s, 'x')$$, current_setting('grp.id')), 'not_group_member');
call pg_temp.expect(format($$select public.leave_group(%s)$$, current_setting('grp.id')), 'not_group_member');
call pg_temp.expect(format($$select public.set_group_agents(%s, array['durian'])$$, current_setting('grp.id')), 'not_group_member');
call pg_temp.expect(format($$select public.add_group_members(%s, array['c9000000-0000-0000-0000-00000000000d']::uuid[])$$, current_setting('grp.id')), 'not_group_member');
-- 不能直接写表
call pg_temp.expect($$insert into public.group_members (group_id, user_id) values (1, 'c9000000-0000-0000-0000-00000000000e')$$, 'permission denied for table group_members');
call pg_temp.expect($$insert into public.messages (sender_id, group_id, body) values ('c9000000-0000-0000-0000-00000000000e', 1, 'x')$$, 'permission denied for table messages');

-- ===== 引用：跨群、跨私聊都不行 =====
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000a');
do $$
declare dm public.messages; other public.messages;
begin
  dm := public.send_message('c9000000-0000-0000-0000-00000000000b', 'dm 里的话');
  perform set_config('grp.dm', dm.id::text, false);
  other := public.send_group_message(current_setting('grp.solo')::bigint, '另一个群里的话');
  perform set_config('grp.other', other.id::text, false);
end $$;
call pg_temp.expect(format($$select public.send_group_message(%s, 'x', %s)$$, current_setting('grp.id'), current_setting('grp.other')), 'invalid_reply');
call pg_temp.expect(format($$select public.send_group_message(%s, 'x', %s)$$, current_setting('grp.id'), current_setting('grp.dm')), 'invalid_reply');
call pg_temp.expect(format($$select public.send_group_message(%s, 'x', 99999999)$$, current_setting('grp.id')), 'invalid_reply');
-- 私聊里引用群消息也不行
call pg_temp.expect(format($$select public.send_message('c9000000-0000-0000-0000-00000000000b', 'x', %s)$$, current_setting('grp.m1')), 'invalid_reply');

-- ===== 拉人 =====
-- bob 想拉 dave（不是 bob 的好友）
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000b');
call pg_temp.expect(format($$select public.add_group_members(%s, array['c9000000-0000-0000-0000-00000000000d']::uuid[])$$, current_setting('grp.id')), 'not_friends');
call pg_temp.expect(format($$select public.add_group_members(%s, array['c9000000-0000-0000-0000-00000000000c']::uuid[])$$, current_setting('grp.id')), 'invalid_members'); -- 已经在群里
-- alice 拉 dave
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000a');
do $$
declare n int; body text;
begin
  n := public.add_group_members(current_setting('grp.id')::bigint, array['c9000000-0000-0000-0000-00000000000d','c9000000-0000-0000-0000-00000000000d']::uuid[]);
  if n <> 1 then raise exception 'expected 1 added, got %', n; end if;
  select m.body into body from public.messages m where m.group_id = current_setting('grp.id')::bigint and m.author = 'system' order by m.id desc limit 1;
  if body <> 'gp_alice 邀请 gp_dave 加入了群聊' then raise exception 'bad invite line: %', body; end if;
end $$;
-- dave 能看到加入之前的消息？按设计群成员能看到整个群的历史
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000d');
do $$ begin
  if (select count(*) from public.groups where id = current_setting('grp.id')::bigint) <> 1 then raise exception 'dave is in now'; end if;
end $$;

-- ===== 人数上限 50 =====
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000a');
do $$
declare i int; uid uuid; ids uuid[] := '{}'; g public.groups;
begin
  reset role;
  for i in 1..49 loop
    uid := gen_random_uuid();
    insert into auth.users (id, email) values (uid, 'gp_bulk' || i || '@group-test.local');
    insert into public.friendships (requester_id, addressee_id, status) values ('c9000000-0000-0000-0000-00000000000a', uid, 'accepted');
    ids := ids || uid;
  end loop;
  perform set_config('role', 'authenticated', false);
  perform set_config('request.jwt.claims', json_build_object('sub', 'c9000000-0000-0000-0000-00000000000a', 'role', 'authenticated')::text, false);
  g := public.create_group('满员群', ids);  -- 1 + 49 = 50
  perform set_config('grp.full', g.id::text, false);
  if (select count(*) from public.group_members where group_id = g.id) <> 50 then raise exception 'full group should have 50'; end if;
end $$;
call pg_temp.expect(format($$select public.add_group_members(%s, array['c9000000-0000-0000-0000-00000000000b']::uuid[])$$, current_setting('grp.full')), 'group_full');

-- ===== 改群名 / 助手开关 =====
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000b');
call pg_temp.expect(format($$select public.rename_group(%s, '')$$, current_setting('grp.id')), 'invalid_group_name');
call pg_temp.expect(format($$select public.rename_group(%s, repeat('长', 21))$$, current_setting('grp.id')), 'invalid_group_name');
call pg_temp.expect(format($$select public.set_group_agents(%s, array['nobody'])$$, current_setting('grp.id')), 'invalid_argument');
do $$
declare g public.groups; body text;
begin
  g := public.rename_group(current_setting('grp.id')::bigint, '新群名');
  if g.name <> '新群名' then raise exception 'rename failed'; end if;
  select m.body into body from public.messages m where m.group_id = g.id and m.author = 'system' order by m.id desc limit 1;
  if body <> 'gp_bob 把群名改成 新群名' then raise exception 'bad rename line: %', body; end if;
  g := public.set_group_agents(g.id, array['durian', 'ye_ying', 'durian']);
  if g.agents <> array['durian','ye_ying'] then raise exception 'agents not set: %', g.agents; end if;
  if (select count(*) from public.messages m where m.group_id = g.id and m.author = 'system' and m.body in ('gp_bob 打开了沈剑心', 'gp_bob 打开了叶英')) <> 2 then raise exception 'agent-on lines missing'; end if;
  g := public.set_group_agents(g.id, array['ye_ying']);
  select m.body into body from public.messages m where m.group_id = g.id and m.author = 'system' order by m.id desc limit 1;
  if body <> 'gp_bob 关掉了沈剑心' then raise exception 'bad agent-off line: %', body; end if;
end $$;

-- ===== 助手提问：群里必须已打开；成员；@；限额共享 =====
do $$
declare m public.messages;
begin
  m := public.send_group_message(current_setting('grp.id')::bigint, '@叶英 今天吃什么');
  perform set_config('grp.askYe', m.id::text, false);
  m := public.send_group_message(current_setting('grp.id')::bigint, '＠沈剑心 你呢');
  perform set_config('grp.askDu', m.id::text, false);
  m := public.send_group_message(current_setting('grp.id')::bigint, '没有叫任何人');
  perform set_config('grp.askNone', m.id::text, false);
end $$;
-- 沈剑心刚被关掉
call pg_temp.expect(format($$select public.agent_ask_group(%s, 'durian')$$, current_setting('grp.askDu')), 'agent_not_enabled');
call pg_temp.expect(format($$select public.agent_ask_group(%s, 'ye_ying')$$, current_setting('grp.askNone')), 'agent_not_mentioned');
call pg_temp.expect(format($$select public.agent_ask_group(%s, 'ye_ying')$$, current_setting('grp.askDu')), 'agent_not_mentioned');
call pg_temp.expect($$select public.agent_ask_group(99999999, 'ye_ying')$$, 'agent_forbidden');
call pg_temp.expect(format($$select public.agent_ask_group(%s, 'ye_ying')$$, current_setting('grp.dm')), 'agent_forbidden'); -- 私聊消息
call pg_temp.expect(format($$select public.agent_ask(%s, 'ye_ying')$$, current_setting('grp.askYe')), 'not_friends'); -- 私聊的函数不接群消息
do $$
declare j public.agent_jobs;
begin
  j := public.agent_ask_group(current_setting('grp.askYe')::bigint, 'ye_ying');
  if j.group_id <> current_setting('grp.id')::bigint or j.peer is not null or j.asker <> 'c9000000-0000-0000-0000-00000000000b' or j.status <> 'pending' then raise exception 'bad job %', j; end if;
  perform set_config('grp.job', j.id::text, false);
end $$;
-- 同一个群同一个助手同时只有一个任务；同一条消息不能重复问
call pg_temp.expect(format($$select public.agent_ask_group(%s, 'ye_ying')$$, current_setting('grp.askYe')), 'agent_busy');
-- 其他成员也能看到这个任务（「思考中」）
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000c');
do $$ begin
  if (select count(*) from public.agent_jobs where id = current_setting('grp.job')::bigint) <> 1 then raise exception 'group members see group jobs'; end if;
end $$;
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000e');
do $$ begin
  if (select count(*) from public.agent_jobs) <> 0 then raise exception 'outsider sees no jobs'; end if;
end $$;
-- carol 在叶英忙的时候也问叶英：busy；问沈剑心：没打开
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000c');
do $$
declare m public.messages;
begin
  m := public.send_group_message(current_setting('grp.id')::bigint, '@叶英 我也想问');
  perform set_config('grp.askYe2', m.id::text, false);
end $$;
call pg_temp.expect(format($$select public.agent_ask_group(%s, 'ye_ying')$$, current_setting('grp.askYe2')), 'agent_busy');
-- 不是发消息的人不能用别人的消息提问
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000b');
call pg_temp.expect(format($$select public.agent_ask_group(%s, 'ye_ying')$$, current_setting('grp.askYe2')), 'agent_forbidden');
-- 任务结束后可以再问；卡住 3 分钟的任务自动失败
reset role;
update public.agent_jobs set status = 'running', updated_at = now() - interval '4 minutes' where id = current_setting('grp.job')::bigint;
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000c');
do $$
declare j public.agent_jobs;
begin
  j := public.agent_ask_group(current_setting('grp.askYe2')::bigint, 'ye_ying');
  if j.status <> 'pending' then raise exception 'stale job should be cleaned'; end if;
  if (select status from public.agent_jobs where id = current_setting('grp.job')::bigint) <> 'failed' then raise exception 'stale job not failed'; end if;
end $$;
-- 被移出后不能再问
-- （先在下面移出 bob 之后再测）

-- ===== 群记忆：用户读不到、写不了 =====
reset role;
insert into public.agent_group_memories (group_id, agent_id, title, content) values (current_setting('grp.id')::bigint, 'ye_ying', '口味', '大家都爱吃辣');
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000c');
do $$ begin
  begin
    perform count(*) from public.agent_group_memories;
    raise exception 'members must not read group memories directly';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
call pg_temp.expect(format($$insert into public.agent_group_memories (group_id, agent_id, title, content) values (%s, 'ye_ying', '口味', 'dup')$$, current_setting('grp.id')), 'duplicate key value violates unique constraint "agent_group_memories_title_uq"');
-- 搜索函数只给 Edge Function：成员不能调；跑一遍内容（不含系统消息，只搜 p_before 之前）
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000c');
call pg_temp.expect(format($$select * from public.agent_search_group_messages(%s, 'x', 5, 999999999)$$, current_setting('grp.id')), 'permission denied for function agent_search_group_messages');
reset role;
do $$
declare n int;
begin
  select count(*) into n from public.agent_search_group_messages(current_setting('grp.id')::bigint, '大家', 5, 999999999);
  if n <> 1 then raise exception 'search should find the chat line, got %', n; end if;
  select count(*) into n from public.agent_search_group_messages(current_setting('grp.id')::bigint, '加入了群聊', 5, 999999999);
  if n <> 0 then raise exception 'search must skip system lines, got %', n; end if;
  select count(*) into n from public.agent_search_group_messages(current_setting('grp.id')::bigint, '大家', 5, current_setting('grp.m1')::bigint);
  if n <> 0 then raise exception 'p_before must be exclusive, got %', n; end if;
  select count(*) into n from public.agent_search_group_messages(current_setting('grp.solo')::bigint, '大家', 5, 999999999);
  if n <> 0 then raise exception 'search must stay inside the group, got %', n; end if;
end $$;
-- 助手的群回复：服务端用 sender = 提问的人、author = 助手、receiver 为空写入（Edge Function 的写法）
insert into public.messages (sender_id, group_id, body, author) values ('c9000000-0000-0000-0000-00000000000b', current_setting('grp.id')::bigint, '辣的我来', 'ye_ying');
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000a');
do $$ begin
  if (select count(*) from public.messages where group_id = current_setting('grp.id')::bigint and author = 'ye_ying') <> 1 then raise exception 'members see agent replies'; end if;
end $$;
call pg_temp.expect($$insert into public.messages (sender_id, group_id, body, author) values ('c9000000-0000-0000-0000-00000000000a', 1, 'x', 'system')$$, 'permission denied for table messages');
-- 约束：receiver_id 和 group_id 恰好一个
reset role;
call pg_temp.expect(format($$insert into public.messages (sender_id, receiver_id, group_id, body) values ('c9000000-0000-0000-0000-00000000000a', 'c9000000-0000-0000-0000-00000000000b', %s, 'x')$$, current_setting('grp.id')), 'new row for relation "messages" violates check constraint "messages_target_one"');
call pg_temp.expect($$insert into public.messages (sender_id, body) values ('c9000000-0000-0000-0000-00000000000a', 'x')$$, 'new row for relation "messages" violates check constraint "messages_target_one"');

-- ===== 未读 / 已读 / 列表 =====
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000c');
do $$
declare r record;
begin
  select * into r from public.list_groups() where id = current_setting('grp.id')::bigint;
  -- carol 自己发消息（我也想问）时已经把群读到那一条；之后只有助手的回复是未读；系统行不算
  if r.unread_count <> 1 then raise exception 'carol unread expected 1, got %', r.unread_count; end if;
  if r.last_author <> 'ye_ying' or r.last_body <> '辣的我来' then raise exception 'last message wrong: % %', r.last_author, r.last_body; end if;
  if r.name <> '新群名' or r.member_ids is null or array_length(r.member_ids, 1) <> 4 or r.member_ids[1] <> 'c9000000-0000-0000-0000-00000000000a' then raise exception 'bad list row %', r; end if;
  if public.mark_group_read(current_setting('grp.id')::bigint) <> r.last_id then raise exception 'mark_group_read returns the last id'; end if;
  select * into r from public.list_groups() where id = current_setting('grp.id')::bigint;
  if r.unread_count <> 0 or r.last_read_id <> r.last_id then raise exception 'unread should be 0 after read'; end if;
  -- 别人读了不影响我；我自己发的消息不算我的未读
  perform public.send_group_message(current_setting('grp.id')::bigint, '我读完了');
  select * into r from public.list_groups() where id = current_setting('grp.id')::bigint;
  if r.unread_count <> 0 then raise exception 'own message must not be unread'; end if;
end $$;
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000a');
do $$
declare r record; n int;
begin
  select * into r from public.list_groups() where id = current_setting('grp.id')::bigint;
  if r.unread_count <= 0 then raise exception 'alice still has unread'; end if;
  select count(*) into n from public.list_groups();
  if n <> 3 then raise exception 'alice is in 3 groups, got %', n; end if;
  -- 群消息不进私聊的会话列表和未读
  if exists (select 1 from public.list_conversations() c where c.last_body = '我读完了' or c.unread_count > 0 and c.peer_id = 'c9000000-0000-0000-0000-00000000000c') then raise exception 'DM list must ignore group rows'; end if;
  if public.mark_read('c9000000-0000-0000-0000-00000000000c') <> 0 then raise exception 'mark_read must not touch group rows'; end if;
end $$;

-- ===== 移出成员：只有群主 =====
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000b');
call pg_temp.expect(format($$select public.remove_group_member(%s, 'c9000000-0000-0000-0000-00000000000c')$$, current_setting('grp.id')), 'not_group_owner');
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000a');
call pg_temp.expect(format($$select public.remove_group_member(%s, 'c9000000-0000-0000-0000-00000000000a')$$, current_setting('grp.id')), 'invalid_argument');
call pg_temp.expect(format($$select public.remove_group_member(%s, 'c9000000-0000-0000-0000-00000000000e')$$, current_setting('grp.id')), 'not_group_member');
do $$
declare body text;
begin
  perform public.remove_group_member(current_setting('grp.id')::bigint, 'c9000000-0000-0000-0000-00000000000b');
  select m.body into body from public.messages m where m.group_id = current_setting('grp.id')::bigint and m.author = 'system' order by m.id desc limit 1;
  if body <> 'gp_alice 把 gp_bob 移出了群聊' then raise exception 'bad remove line: %', body; end if;
end $$;
-- 被移出的 bob：看不到群、消息、不能发、不能再叫助手、也看不到群里其他人的资料（除非本来是好友）
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000b');
do $$ begin
  if (select count(*) from public.messages where group_id = current_setting('grp.id')::bigint) <> 0 then raise exception 'removed member still sees messages'; end if;
  if (select count(*) from public.groups where id = current_setting('grp.id')::bigint) <> 0 then raise exception 'removed member still sees group'; end if;
  if (select count(*) from public.agent_jobs where group_id = current_setting('grp.id')::bigint) <> 0 then raise exception 'removed member still sees jobs'; end if;
  if (select count(*) from public.profiles where id = 'c9000000-0000-0000-0000-00000000000d') <> 0 then raise exception 'removed member should not see dave profile (not a friend)'; end if;
end $$;
call pg_temp.expect(format($$select public.send_group_message(%s, 'hi')$$, current_setting('grp.id')), 'not_group_member');
call pg_temp.expect(format($$select public.agent_ask_group(%s, 'ye_ying')$$, current_setting('grp.askYe')), 'not_group_member');

-- ===== 退群：群主转移 / 最后一个人退群删群 =====
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000a');
do $$
declare gone boolean; body text;
begin
  -- alice 是群主；剩下 carol（先加入）和 dave（后加入）
  gone := public.leave_group(current_setting('grp.id')::bigint);
  if gone then raise exception 'group must survive'; end if;
end $$;
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000c');
do $$
declare g public.groups; body text;
begin
  select * into g from public.groups where id = current_setting('grp.id')::bigint;
  if g.owner_id <> 'c9000000-0000-0000-0000-00000000000c' then raise exception 'owner should transfer to earliest member carol, got %', g.owner_id; end if;
  select m.body into body from public.messages m where m.group_id = g.id and m.author = 'system' order by m.id desc limit 1;
  if body <> 'gp_alice 退出了群聊' then raise exception 'bad leave line: %', body; end if;
end $$;
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000a');
do $$ begin
  if (select count(*) from public.messages where group_id = current_setting('grp.id')::bigint) <> 0 then raise exception 'left member still sees messages'; end if;
end $$;
-- 非群主退群：群主不变
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000d');
do $$ begin
  if public.leave_group(current_setting('grp.id')::bigint) then raise exception 'carol still there'; end if;
  if (select owner_id from public.groups where id = current_setting('grp.id')::bigint) is not null then null; end if;
end $$;
-- dave 退群后他看不到群了；carol 是最后一个，退群后群和消息、任务、记忆都没了
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000c');
do $$ begin
  if (select owner_id from public.groups where id = current_setting('grp.id')::bigint) <> 'c9000000-0000-0000-0000-00000000000c' then raise exception 'owner unchanged'; end if;
  if not public.leave_group(current_setting('grp.id')::bigint) then raise exception 'last member leaving must delete the group'; end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.groups where id = current_setting('grp.id')::bigint)
     or exists (select 1 from public.messages where group_id = current_setting('grp.id')::bigint)
     or exists (select 1 from public.group_members where group_id = current_setting('grp.id')::bigint)
     or exists (select 1 from public.agent_jobs where group_id = current_setting('grp.id')::bigint)
     or exists (select 1 from public.agent_group_memories where group_id = current_setting('grp.id')::bigint) then
    raise exception 'group data should be deleted with the group';
  end if;
end $$;

-- ===== 私聊不受影响 =====
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000a');
do $$
declare m public.messages; r record;
begin
  m := public.send_message('c9000000-0000-0000-0000-00000000000d', '私聊一句');
  if m.group_id is not null or m.receiver_id <> 'c9000000-0000-0000-0000-00000000000d' then raise exception 'DM row wrong'; end if;
end $$;
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000d');
do $$
begin
  if (select count(*) from public.messages where body = '私聊一句') <> 1 then raise exception 'receiver sees DM'; end if;
  if public.mark_read('c9000000-0000-0000-0000-00000000000a') <> 1 then raise exception 'mark_read works for DM'; end if;
end $$;
call pg_temp.as_user('c9000000-0000-0000-0000-00000000000c');
do $$ begin
  if (select count(*) from public.messages where body = '私聊一句') <> 0 then raise exception 'third party must not see DM'; end if;
end $$;

-- ===== 清理 =====
reset role;
delete from auth.users where email like '%@group-test.local';
do $$ begin
  if exists (select 1 from public.profiles where username like 'gp\_%') then raise exception 'cleanup failed'; end if;
  if exists (select 1 from public.groups) or exists (select 1 from public.group_members) then raise exception 'groups not cleaned'; end if;
end $$;

select 'all group chat tests passed';
