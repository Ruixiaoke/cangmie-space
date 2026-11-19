-- 沈剑心（messages.author、agent_jobs、agent_memories、agent_ask、agent_search_messages）的测试，CI 在临时 Postgres 上运行
-- 自带数据：开头清理上一次的测试用户，结尾再清理
\set ON_ERROR_STOP on
\set QUIET on

delete from auth.users where email like '%@agent-test.local';

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
  ('a9000000-0000-0000-0000-00000000000a', 'ag_alice@agent-test.local'),
  ('a9000000-0000-0000-0000-00000000000b', 'ag_bob@agent-test.local'),
  ('a9000000-0000-0000-0000-00000000000c', 'ag_carol@agent-test.local'),
  ('a9000000-0000-0000-0000-00000000000d', 'ag_dave@agent-test.local');

-- alice-bob、alice-dave 是好友；carol 谁也不是（也不是 alice 的好友）
insert into public.friendships (requester_id, addressee_id, status) values
  ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', 'accepted'),
  ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000d', 'accepted'),
  ('a9000000-0000-0000-0000-00000000000c', 'a9000000-0000-0000-0000-00000000000d', 'pending');

-- ===== 权限：匿名不能调用；search 函数谁都不能调用（只有平台管理员角色） =====
call pg_temp.as_anon();
call pg_temp.expect($$select public.agent_ask(1)$$, 'permission denied for function agent_ask');
-- CI 里 anon 被授予了全部表权限（模拟 Supabase 默认权限），所以靠 RLS 挡：读到 0 行、写入被拒
do $$ begin
  if (select count(*) from public.agent_jobs) <> 0 or (select count(*) from public.agent_memories) <> 0 then raise exception 'anon must see no rows'; end if;
end $$;
call pg_temp.expect($$insert into public.agent_memories (user_lo, user_hi, content) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', 'x')$$, 'new row violates row-level security policy for table "agent_memories"');
call pg_temp.expect($$insert into public.messages (sender_id, receiver_id, body, author) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', 'x', 'durian')$$, 'author_forbidden');
call pg_temp.as_user('a9000000-0000-0000-0000-00000000000a');
call pg_temp.expect($$select * from public.agent_search_messages('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', 'x')$$, 'permission denied for function agent_search_messages');

-- ===== 提问的各种拒绝 =====
call pg_temp.as_user('a9000000-0000-0000-0000-00000000000a');
do $$
declare plain public.messages; ask public.messages; toDave public.messages;
begin
  plain := public.send_message('a9000000-0000-0000-0000-00000000000b', '今天吃什么');
  ask   := public.send_message('a9000000-0000-0000-0000-00000000000b', '＠叶英 今天吃什么？也请 @沈剑心 听听');
  toDave := public.send_message('a9000000-0000-0000-0000-00000000000d', '@沈剑心 你好');
  perform set_config('agent.plain', plain.id::text, false);
  perform set_config('agent.ask', ask.id::text, false);
  perform set_config('agent.toDave', toDave.id::text, false);
end $$;

-- 没有 @沈剑心
call pg_temp.expect(format($$select public.agent_ask(%s)$$, current_setting('agent.plain')), 'agent_not_mentioned');
-- 不存在的消息
call pg_temp.expect($$select public.agent_ask(999999999)$$, 'agent_forbidden');

-- 不是发送者：bob 想用 alice 的消息提问
call pg_temp.as_user('a9000000-0000-0000-0000-00000000000b');
call pg_temp.expect(format($$select public.agent_ask(%s)$$, current_setting('agent.ask')), 'agent_forbidden');

-- 不是好友：bob 发给 alice 之后 alice 删好友关系的情形；这里用 carol（和 dave 只有待处理请求）
reset role;
insert into public.friendships (requester_id, addressee_id, status) values
  ('a9000000-0000-0000-0000-00000000000b', 'a9000000-0000-0000-0000-00000000000c', 'accepted');
call pg_temp.as_user('a9000000-0000-0000-0000-00000000000c');
do $$
declare m public.messages;
begin
  m := public.send_message('a9000000-0000-0000-0000-00000000000b', '@沈剑心 hi');
  perform set_config('agent.carolMsg', m.id::text, false);
end $$;
reset role;
delete from public.friendships where requester_id = 'a9000000-0000-0000-0000-00000000000b' and addressee_id = 'a9000000-0000-0000-0000-00000000000c';
call pg_temp.as_user('a9000000-0000-0000-0000-00000000000c');
call pg_temp.expect(format($$select public.agent_ask(%s)$$, current_setting('agent.carolMsg')), 'not_friends');

-- 太旧的消息
reset role;
update public.messages set created_at = now() - interval '11 minutes' where id = current_setting('agent.toDave')::bigint;
call pg_temp.as_user('a9000000-0000-0000-0000-00000000000a');
call pg_temp.expect(format($$select public.agent_ask(%s)$$, current_setting('agent.toDave')), 'agent_too_old');

-- ===== 成功提问，同一对好友同时只有一个进行中的任务 =====
do $$
declare j public.agent_jobs;
begin
  j := public.agent_ask(current_setting('agent.ask')::bigint);
  if j.agent_id <> 'ye_ying' or j.status <> 'pending' or j.asker <> 'a9000000-0000-0000-0000-00000000000a' or j.peer <> 'a9000000-0000-0000-0000-00000000000b' then
    raise exception 'job not created as expected: %', j; end if;
  perform set_config('agent.job', j.id::text, false);
end $$;
-- 同一条消息再问
call pg_temp.expect(format($$select public.agent_ask(%s)$$, current_setting('agent.ask')), 'agent_busy');
-- 同一条消息同时点名两位助手，两位可以各自有一个正在进行的任务。
begin;
do $$
declare j public.agent_jobs;
begin
  j := public.agent_ask(current_setting('agent.ask')::bigint, 'durian');
  if j.agent_id <> 'durian' or j.status <> 'pending' then
    raise exception 'second agent job missing';
  end if;
  if (select count(*) from public.agent_jobs where message_id = j.message_id and status = 'pending') <> 2 then
    raise exception 'both agents should be pending';
  end if;
end $$;
call pg_temp.expect(format($$select public.agent_ask(%s, 'durian')$$, current_setting('agent.ask')), 'agent_busy');
call pg_temp.expect(format($$select public.agent_ask(%s, 'ye_ying')$$, current_setting('agent.toDave')), 'agent_not_mentioned');
rollback;
-- 同一对好友，另一条消息
do $$
declare m public.messages;
begin
  m := public.send_message('a9000000-0000-0000-0000-00000000000b', '@沈剑心 再问一个');
  perform set_config('agent.ask2', m.id::text, false);
end $$;
call pg_temp.expect(format($$select public.agent_ask(%s)$$, current_setting('agent.ask2')), 'agent_busy');
-- bob 在同一对好友里也不能再开一个
call pg_temp.as_user('a9000000-0000-0000-0000-00000000000b');
do $$
declare m public.messages;
begin
  m := public.send_message('a9000000-0000-0000-0000-00000000000a', '@沈剑心 我也问');
  perform set_config('agent.askB', m.id::text, false);
end $$;
call pg_temp.expect(format($$select public.agent_ask(%s)$$, current_setting('agent.askB')), 'agent_busy');
-- alice 和别的好友（dave）是另一对：不受影响
call pg_temp.as_user('a9000000-0000-0000-0000-00000000000a');
reset role;
update public.messages set created_at = now() where id = current_setting('agent.toDave')::bigint;
call pg_temp.as_user('a9000000-0000-0000-0000-00000000000a');
do $$ begin perform public.agent_ask(current_setting('agent.toDave')::bigint); end $$;

-- ===== RLS：双方能看到任务，第三个人看不到；客户端不能写 =====
do $$ begin
  if (select count(*) from public.agent_jobs) <> 2 then raise exception 'alice should see her 2 jobs'; end if;
end $$;
call pg_temp.as_user('a9000000-0000-0000-0000-00000000000b');
do $$ begin
  if (select count(*) from public.agent_jobs) <> 1 then raise exception 'bob should see the job of his pair only'; end if;
end $$;
call pg_temp.as_user('a9000000-0000-0000-0000-00000000000c');
do $$ begin
  if (select count(*) from public.agent_jobs) <> 0 then raise exception 'carol must not see jobs'; end if;
end $$;
call pg_temp.expect($$insert into public.agent_jobs (asker, peer, message_id) values ('a9000000-0000-0000-0000-00000000000c', 'a9000000-0000-0000-0000-00000000000d', 1)$$, 'permission denied for table agent_jobs');
call pg_temp.as_user('a9000000-0000-0000-0000-00000000000a');
call pg_temp.expect($$update public.agent_jobs set status = 'done'$$, 'permission denied for table agent_jobs');
call pg_temp.expect($$delete from public.agent_jobs$$, 'permission denied for table agent_jobs');

-- ===== 卡住的任务 3 分钟后让位 =====
reset role;
update public.agent_jobs set updated_at = now() - interval '4 minutes' where id = current_setting('agent.job')::bigint;
call pg_temp.as_user('a9000000-0000-0000-0000-00000000000a');
do $$
declare j public.agent_jobs;
begin
  j := public.agent_ask(current_setting('agent.ask2')::bigint);
  if j.status <> 'pending' then raise exception 'new job should be pending'; end if;
  perform set_config('agent.job2', j.id::text, false);
end $$;
reset role;
do $$ begin
  if (select status || '/' || error from public.agent_jobs where id = current_setting('agent.job')::bigint) <> 'failed/timeout' then
    raise exception 'stale job should be failed/timeout'; end if;
end $$;

-- ===== 状态流转后可以再问 =====
update public.agent_jobs set status = 'done' where id = current_setting('agent.job2')::bigint;
call pg_temp.as_user('a9000000-0000-0000-0000-00000000000b');
do $$ begin perform public.agent_ask(current_setting('agent.askB')::bigint); end $$;

-- ===== 不限次数：24 小时里问过 50 次，照样能问 =====
reset role;
update public.agent_jobs set status = 'done' where status in ('pending', 'running');
do $$
declare i int; m bigint;
begin
  -- alice 已经有 3 个任务（含失败的）；再补 47 个凑满 50
  for i in 1..47 loop
    insert into public.messages (sender_id, receiver_id, body)
    values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', '@沈剑心 批量 ' || i) returning id into m;
    insert into public.agent_jobs (asker, peer, message_id, status) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', m, 'done');
  end loop;
  if (select count(*) from public.agent_jobs where asker = 'a9000000-0000-0000-0000-00000000000a') <> 50 then
    raise exception 'expected 50 jobs for alice, got %', (select count(*) from public.agent_jobs where asker = 'a9000000-0000-0000-0000-00000000000a'); end if;
end $$;
call pg_temp.as_user('a9000000-0000-0000-0000-00000000000a');
do $$
declare m public.messages;
begin
  m := public.send_message('a9000000-0000-0000-0000-00000000000b', '@沈剑心 第五十一个');
  perform set_config('agent.ask51', m.id::text, false);
end $$;
call pg_temp.as_user('a9000000-0000-0000-0000-00000000000a');
do $$ begin perform public.agent_ask(current_setting('agent.ask51')::bigint); end $$;

-- ===== author：用户不能写 =====
-- 直接写 messages：没有权限
call pg_temp.expect($$insert into public.messages (sender_id, receiver_id, body, author) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', 'fake durian', 'durian')$$, 'permission denied for table messages');
call pg_temp.expect($$update public.messages set author = 'durian' where sender_id = 'a9000000-0000-0000-0000-00000000000a'$$, 'permission denied for table messages');
-- send_message 的结果永远没有 author
do $$
declare m public.messages;
begin
  m := public.send_message('a9000000-0000-0000-0000-00000000000b', 'plain');
  if m.author is not null then raise exception 'send_message must not set author'; end if;
end $$;
-- 4000 字的真人消息：被拒
call pg_temp.expect($$select public.send_message('a9000000-0000-0000-0000-00000000000b', repeat('x', 2001))$$, 'message_too_long');

-- 兜底触发器：即使有人给 authenticated 开了写权限和写策略，也不能写 author
reset role;
grant insert, update on public.messages to authenticated;
create policy agent_test_tmp_ins on public.messages for insert to authenticated with check (true);
create policy agent_test_tmp_upd on public.messages for update to authenticated using (true) with check (true);
call pg_temp.as_user('a9000000-0000-0000-0000-00000000000a');
call pg_temp.expect($$insert into public.messages (sender_id, receiver_id, body, author) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', 'fake durian', 'durian')$$, 'author_forbidden');
call pg_temp.expect($$insert into public.messages (sender_id, receiver_id, body) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', 'direct ok')$$, 'ok');
call pg_temp.expect($$update public.messages set author = 'durian' where body = 'direct ok'$$, 'author_forbidden');
call pg_temp.expect($$update public.messages set body = 'direct edited' where body = 'direct ok'$$, 'ok');
reset role;
drop policy agent_test_tmp_ins on public.messages;
drop policy agent_test_tmp_upd on public.messages;
revoke insert, update on public.messages from authenticated;

-- ===== 沈剑心的回复（平台管理员角色写入，这里用超级用户代替）：4000 字上限只对 author 行 =====
do $$
declare r public.messages;
begin
  insert into public.messages (sender_id, receiver_id, body, author)
  values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', repeat('长', 4000), 'durian') returning * into r;
  perform set_config('agent.reply', r.id::text, false);
  begin
    insert into public.messages (sender_id, receiver_id, body, author)
    values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', repeat('长', 4001), 'durian');
    raise exception 'author rows must be capped at 4000';
  exception when check_violation then null; end;
  begin
    insert into public.messages (sender_id, receiver_id, body) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', repeat('长', 2001));
    raise exception 'human rows must be capped at 2000';
  exception when check_violation then null; end;
  begin
    insert into public.messages (sender_id, receiver_id, body, author) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', 'x', 'someone');
    raise exception 'unknown author must be rejected';
  exception when check_violation then null; end;
end $$;

-- 双方都能看到沈剑心的回复，第三个人看不到
call pg_temp.as_user('a9000000-0000-0000-0000-00000000000a');
do $$ begin
  if not exists (select 1 from public.messages where id = current_setting('agent.reply')::bigint and author = 'durian') then raise exception 'alice should see the reply'; end if; end $$;
call pg_temp.as_user('a9000000-0000-0000-0000-00000000000b');
do $$ begin
  if not exists (select 1 from public.messages where id = current_setting('agent.reply')::bigint and author = 'durian') then raise exception 'bob should see the reply'; end if;
end $$;
call pg_temp.as_user('a9000000-0000-0000-0000-00000000000c');
do $$ begin
  if exists (select 1 from public.messages where author = 'durian') then raise exception 'carol must not see agent messages'; end if; end $$;
-- 前端用 id 集合 + author 非空 查出哪些「最后一条」是沈剑心的
reset role;
insert into public.messages (sender_id, receiver_id, body, author)
values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', '最后一条', 'durian');
call pg_temp.as_user('a9000000-0000-0000-0000-00000000000b');
do $$ begin
  if (select count(*) from public.messages where id in (select last_id from public.list_conversations()) and author is not null) <> 1 then
    raise exception 'last message should be found as an agent message'; end if;
end $$;

-- ===== 记忆：带标题的条目。一对好友共用，第三个人看不到，客户端不能写，上限 200，pinned 上限 10 =====
reset role;
insert into public.agent_memories (user_lo, user_hi, title, content)
values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', '小明·口味', '她不吃香菜');
call pg_temp.expect($$insert into public.agent_memories (user_lo, user_hi, title, content) values ('a9000000-0000-0000-0000-00000000000b', 'a9000000-0000-0000-0000-00000000000a', 't', 'x')$$, 'new row for relation "agent_memories" violates check constraint "agent_memories_ordered"');
-- 标题必填、1 到 20 字、不能有首尾空白；内容 1 到 500 字
call pg_temp.expect($$insert into public.agent_memories (user_lo, user_hi, content) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', 'x')$$, 'null value in column "title" of relation "agent_memories" violates not-null constraint');
call pg_temp.expect($$insert into public.agent_memories (user_lo, user_hi, title, content) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', repeat('题', 21), 'x')$$, 'new row for relation "agent_memories" violates check constraint "agent_memories_title_valid"');
call pg_temp.expect($$insert into public.agent_memories (user_lo, user_hi, title, content) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', ' 空白', 'x')$$, 'new row for relation "agent_memories" violates check constraint "agent_memories_title_valid"');
call pg_temp.expect($$insert into public.agent_memories (user_lo, user_hi, title, content) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', '', 'x')$$, 'new row for relation "agent_memories" violates check constraint "agent_memories_title_valid"');
call pg_temp.expect($$insert into public.agent_memories (user_lo, user_hi, title, content) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', '长内容', repeat('x', 501))$$, 'new row for relation "agent_memories" violates check constraint "agent_memories_content_len"');
call pg_temp.expect($$insert into public.agent_memories (user_lo, user_hi, title, content) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', '二十字', repeat('x', 500))$$, 'ok');
call pg_temp.expect($$insert into public.agent_memories (user_lo, user_hi, title, content) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', repeat('题', 20), 'x')$$, 'ok');
-- 同一对好友里标题唯一；另一对好友可以用同样的标题
call pg_temp.expect($$insert into public.agent_memories (user_lo, user_hi, title, content) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', '小明·口味', 'y')$$, 'duplicate key value violates unique constraint "agent_memories_pair_title_uq"');
call pg_temp.expect($$insert into public.agent_memories (user_lo, user_hi, title, content) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000d', '小明·口味', '另一对同标题')$$, 'ok');
-- 按标题 upsert：更新内容并刷新 updated_at，pinned 不指定时保持原值
update public.agent_memories set updated_at = now() - interval '1 day' where title = '小明·口味';
insert into public.agent_memories (user_lo, user_hi, title, content) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', '小明·口味', '她不吃香菜，也不吃葱')
  on conflict (user_lo, user_hi, agent_id, title) do update set content = excluded.content;
do $$ begin
  if (select count(*) from public.agent_memories where user_lo = 'a9000000-0000-0000-0000-00000000000a' and user_hi = 'a9000000-0000-0000-0000-00000000000b' and title = '小明·口味') <> 1 then raise exception 'upsert must not duplicate'; end if;
  if (select content from public.agent_memories where title = '小明·口味' and user_hi = 'a9000000-0000-0000-0000-00000000000b') <> '她不吃香菜，也不吃葱' then raise exception 'upsert must replace content'; end if;
  if (select updated_at from public.agent_memories where title = '小明·口味' and user_hi = 'a9000000-0000-0000-0000-00000000000b') < now() - interval '1 minute' then raise exception 'updated_at must refresh'; end if;
end $$;
call pg_temp.as_user('a9000000-0000-0000-0000-00000000000a');
do $$ begin if (select count(*) from public.agent_memories) <> 4 then raise exception 'alice should see her 4 entries, got %', (select count(*) from public.agent_memories); end if; end $$;
call pg_temp.as_user('a9000000-0000-0000-0000-00000000000b');
do $$ begin if (select count(*) from public.agent_memories) <> 3 then raise exception 'bob should see the 3 shared entries'; end if; end $$;
call pg_temp.as_user('a9000000-0000-0000-0000-00000000000c');
do $$ begin if (select count(*) from public.agent_memories) <> 0 then raise exception 'carol must not see memories'; end if; end $$;
call pg_temp.as_user('a9000000-0000-0000-0000-00000000000d');
do $$ begin if (select count(*) from public.agent_memories) <> 1 then raise exception 'dave sees only his own pair entry'; end if; end $$;
call pg_temp.as_user('a9000000-0000-0000-0000-00000000000a');
call pg_temp.expect($$insert into public.agent_memories (user_lo, user_hi, title, content) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', 'x', 'x')$$, 'permission denied for table agent_memories');
call pg_temp.expect($$update public.agent_memories set content = 'x'$$, 'permission denied for table agent_memories');
call pg_temp.expect($$delete from public.agent_memories$$, 'permission denied for table agent_memories');
reset role;
-- pinned 最多 10 条（同标题更新不算新增）
do $$
declare i int;
begin
  for i in 1..10 loop
    insert into public.agent_memories (user_lo, user_hi, title, content, pinned) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', '常驻' || i, '内容', true);
  end loop;
end $$;
call pg_temp.expect($$insert into public.agent_memories (user_lo, user_hi, title, content, pinned) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', '常驻11', 'x', true)$$, 'pinned_full');
call pg_temp.expect($$update public.agent_memories set pinned = true where title = '小明·口味' and user_hi = 'a9000000-0000-0000-0000-00000000000b'$$, 'pinned_full');
call pg_temp.expect($$insert into public.agent_memories (user_lo, user_hi, title, content, pinned) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', '常驻1', '改过', true) on conflict (user_lo, user_hi, agent_id, title) do update set content = excluded.content, pinned = excluded.pinned$$, 'ok');
call pg_temp.expect($$update public.agent_memories set pinned = false where title = '常驻1'$$, 'ok');
call pg_temp.expect($$insert into public.agent_memories (user_lo, user_hi, title, content, pinned) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000d', '另一对常驻', 'x', true)$$, 'ok');
-- 总条数上限 200（用同标题更新已有条目在满额时仍然可以）
do $$
declare i int;
begin
  for i in 1..(200 - (select count(*) from public.agent_memories where user_lo = 'a9000000-0000-0000-0000-00000000000a' and user_hi = 'a9000000-0000-0000-0000-00000000000b')) loop
    insert into public.agent_memories (user_lo, user_hi, title, content) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', '记忆' || i, '内容');
  end loop;
end $$;
call pg_temp.expect($$insert into public.agent_memories (user_lo, user_hi, title, content) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', '第201条', 'x')$$, 'memory_full');
call pg_temp.expect($$insert into public.agent_memories (user_lo, user_hi, agent_id, title, content, pinned) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', 'ye_ying', '小明·口味', '叶英的记忆', true)$$, 'ok');
call pg_temp.expect($$insert into public.agent_memories (user_lo, user_hi, title, content) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', '记忆1', '满额时更新') on conflict (user_lo, user_hi, agent_id, title) do update set content = excluded.content$$, 'ok');
-- 另一对好友不受影响
call pg_temp.expect($$insert into public.agent_memories (user_lo, user_hi, title, content) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000d', '又一条', '另一对')$$, 'ok');

-- ===== 旧数据迁移：没有标题的老行补成「未分类·编号」，内容保留，再次执行迁移是空操作 =====
do $$
declare v_id bigint; v_title text; v_sql text;
begin
  -- 模拟迁移前的状态：去掉 not null，塞一条没标题的旧行，把迁移文件里的补标题语句再跑一遍
  alter table public.agent_memories alter column title drop not null;
  insert into public.agent_memories (user_lo, user_hi, title, content) values ('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000d', null, '旧记忆原文') returning id into v_id;
  update public.agent_memories set title = '未分类·' || id where title is null;
  alter table public.agent_memories alter column title set not null;
  select title into v_title from public.agent_memories where id = v_id;
  if v_title <> '未分类·' || v_id then raise exception 'old row title wrong: %', v_title; end if;
  if (select content from public.agent_memories where id = v_id) <> '旧记忆原文' then raise exception 'old content lost'; end if;
end $$;

-- ===== 搜聊天记录：只搜这一对，通配符被转义 =====
call pg_temp.as_user('a9000000-0000-0000-0000-00000000000a');
select public.send_message('a9000000-0000-0000-0000-00000000000b', '周末去爬山 100% 开心') is not null;
select public.send_message('a9000000-0000-0000-0000-00000000000d', '周末去爬山，只和 dave 说') is not null;
call pg_temp.as_user('a9000000-0000-0000-0000-00000000000b');
select public.send_message('a9000000-0000-0000-0000-00000000000a', '爬山要带水') is not null;
select public.send_message('a9000000-0000-0000-0000-00000000000a', repeat('长', 400)) is not null;
reset role;
do $$
declare n int;
begin
  select count(*) into n from public.agent_search_messages('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', '爬山', 10);
  if n <> 2 then raise exception 'pair search should find 2, got %', n; end if;
  select count(*) into n from public.agent_search_messages('a9000000-0000-0000-0000-00000000000b', 'a9000000-0000-0000-0000-00000000000a', '爬山', 10);
  if n <> 2 then raise exception 'search must be symmetric, got %', n; end if;
  select count(*) into n from public.agent_search_messages('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', 'dave', 10);
  if n <> 0 then raise exception 'search must not leak the other conversation, got %', n; end if;
  select count(*) into n from public.agent_search_messages('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', '%', 10);
  if n <> 1 then raise exception 'percent must be literal, got %', n; end if;
  select count(*) into n from public.agent_search_messages('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', '_', 10);
  if n <> 0 then raise exception 'underscore must be literal, got %', n; end if;
  select count(*) into n from public.agent_search_messages('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', '   ', 10);
  if n <> 0 then raise exception 'blank query returns nothing, got %', n; end if;
  select count(*) into n from public.agent_search_messages('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', '爬山', 1);
  if n <> 1 then raise exception 'limit not applied, got %', n; end if;
  if (select max(length(body)) from public.agent_search_messages('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', '长', 5)) > 160 then
    raise exception 'snippets must be cut to 160 chars'; end if;
  if (select max(length(body)) from public.agent_search_messages('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', '长', 5)) is distinct from 160 then
    raise exception 'long snippet should be exactly 160 chars'; end if;
  select count(*) into n from public.agent_search_messages('a9000000-0000-0000-0000-00000000000a', 'a9000000-0000-0000-0000-00000000000b', '爬山', 99);
  if n > 10 then raise exception 'limit must cap at 10'; end if;
end $$;

-- ===== 清理 =====
delete from auth.users where email like '%@agent-test.local';
do $$ begin
  if exists (select 1 from public.profiles where username like 'ag\_%') then raise exception 'cleanup failed'; end if;
  if exists (select 1 from public.agent_jobs j where not exists (select 1 from public.profiles p where p.id = j.asker)) then raise exception 'jobs not cleaned'; end if;
end $$;

select 'all agent tests passed';
