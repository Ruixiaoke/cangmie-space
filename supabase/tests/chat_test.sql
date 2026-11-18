-- 聊天功能的测试，CI 在临时 Postgres 上运行（.github/workflows/ci.yml）
-- 自带数据：开头清理上一次的测试用户，结尾再清理；用 set role + request.jwt.claims 模拟登录用户
\set ON_ERROR_STOP on
\set QUIET on

-- 清理（删 auth.users 会级联删掉资料、好友关系、消息）
delete from auth.users where email like '%@chat-test.local';
delete from storage.objects where bucket_id = 'avatars' and name like 'c0000000-%';

-- 辅助函数（只存在于本次会话）
-- as_user：切换成某个登录用户；as_anon：切换成未登录；err：执行一条 SQL，返回错误信息（成功返回 ok）
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

-- ============================================================
-- 注册触发器和用户名规则（postgres 身份，模拟 Supabase Auth 插入用户）
-- ============================================================
insert into auth.users (id, email, raw_user_meta_data) values
  ('c0000000-0000-0000-0000-00000000000a', 'ct_alice@chat-test.local', '{"nickname":"  爱丽丝  "}'),
  ('c0000000-0000-0000-0000-00000000000b', 'CT_Bob@chat-test.local', '{}'),
  ('c0000000-0000-0000-0000-00000000000c', 'ct_carol@chat-test.local', '{"nickname":"一二三四五六七八九十一二三四五六七八九十多余"}'),
  ('c0000000-0000-0000-0000-00000000000d', 'ct_dave@chat-test.local', '{"nickname":"   "}');

do $$ begin
  if (select nickname from public.profiles where id = 'c0000000-0000-0000-0000-00000000000a') <> '爱丽丝' then
    raise exception 'nickname should come from metadata, trimmed'; end if;
  if (select username from public.profiles where id = 'c0000000-0000-0000-0000-00000000000b') <> 'ct_bob' then
    raise exception 'username should be the lowercased local part'; end if;
  if (select nickname from public.profiles where id = 'c0000000-0000-0000-0000-00000000000b') <> 'ct_bob' then
    raise exception 'nickname should fall back to username'; end if;
  if (select char_length(nickname) from public.profiles where id = 'c0000000-0000-0000-0000-00000000000c') <> 20 then
    raise exception 'long nickname should be cut to 20 chars'; end if;
  if (select nickname from public.profiles where id = 'c0000000-0000-0000-0000-00000000000d') <> 'ct_dave' then
    raise exception 'blank nickname should fall back to username'; end if;
end $$;

-- 不合法的用户名：注册（插入 auth.users）直接失败，也不会留下半个用户
do $$
declare bad text[] := array['ab@chat-test.local', 'has-dash@chat-test.local', 'has.dot@chat-test.local',
                            'waytoolongusername_over20@chat-test.local', '用户名@chat-test.local', '@chat-test.local'];
        b text;
begin
  foreach b in array bad loop
    begin
      insert into auth.users (email) values (b);
      raise exception 'username should have been rejected: %', b;
    exception when check_violation then null;
    end;
  end loop;
  -- 同名（忽略大小写）也不行
  begin
    insert into auth.users (email) values ('CT_ALICE@chat-test.local');
    raise exception 'duplicate username should have been rejected';
  exception when unique_violation then null;
  end;
  if (select count(*) from auth.users where email like '%@chat-test.local') <> 4 then
    raise exception 'rejected signups must not leave users behind';
  end if;
end $$;

-- ============================================================
-- 权限：表只读，匿名什么都看不到
-- ============================================================
call pg_temp.as_anon();
do $$ begin
  if (select count(*) from public.profiles) <> 0 then raise exception 'anon must not read profiles'; end if;
  if (select count(*) from public.friendships) <> 0 then raise exception 'anon must not read friendships'; end if;
  if (select count(*) from public.messages) <> 0 then raise exception 'anon must not read messages'; end if;
  -- username_available 是 anon 唯一能调用的函数
  if public.username_available('ct_alice') then raise exception 'taken username should be unavailable'; end if;
  if not public.username_available('ct_free_name') then raise exception 'free username should be available'; end if;
  if public.username_available('x') then raise exception 'invalid username should be unavailable'; end if;
  if public.username_available(null) then raise exception 'null username should be unavailable'; end if;
end $$;
call pg_temp.expect($$select public.find_user('ct_alice')$$, 'permission denied for function find_user');
call pg_temp.expect($$select public.send_friend_request('ct_alice')$$, 'permission denied for function send_friend_request');
call pg_temp.expect($$select public.respond_friend_request(1, true)$$, 'permission denied for function respond_friend_request');
call pg_temp.expect($$select public.send_message('c0000000-0000-0000-0000-00000000000a', 'hi')$$, 'permission denied for function send_message');
call pg_temp.expect($$select public.mark_read('c0000000-0000-0000-0000-00000000000a')$$, 'permission denied for function mark_read');
call pg_temp.expect($$select public.update_profile('x', null)$$, 'permission denied for function update_profile');
call pg_temp.expect($$select * from public.list_conversations()$$, 'permission denied for function list_conversations');
call pg_temp.expect($$select public.handle_new_user()$$, 'permission denied for function handle_new_user');

-- 登录用户不能直接写表（没有写权限）
call pg_temp.as_user('c0000000-0000-0000-0000-00000000000a');
call pg_temp.expect($$insert into public.messages (sender_id, receiver_id, body) values ('c0000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-00000000000b','x')$$, 'permission denied for table messages');
call pg_temp.expect($$insert into public.friendships (requester_id, addressee_id, status) values ('c0000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-00000000000b','accepted')$$, 'permission denied for table friendships');
call pg_temp.expect($$update public.profiles set nickname = 'hacked'$$, 'permission denied for table profiles');
call pg_temp.expect($$delete from public.messages$$, 'permission denied for table messages');

-- ============================================================
-- 陌生人互相看不到资料；find_user 只返回最少字段
-- ============================================================
do $$ begin
  if (select count(*) from public.profiles) <> 1 then raise exception 'alice should only see her own profile'; end if;
  if (select count(*) from public.profiles where id = 'c0000000-0000-0000-0000-00000000000b') <> 0 then
    raise exception 'strangers must not see each other''s profiles'; end if;
  -- 精确查找
  if (select count(*) from public.find_user('ct_bob')) <> 1 then raise exception 'find_user exact match failed'; end if;
  if (select count(*) from public.find_user('  CT_BOB ')) <> 1 then raise exception 'find_user should be case-insensitive and trimmed'; end if;
  if (select count(*) from public.find_user('ct_bo')) <> 0 then raise exception 'find_user must not do prefix search'; end if;
  if (select count(*) from public.find_user('ct%')) <> 0 then raise exception 'find_user must not do pattern search'; end if;
  if (select relation from public.find_user('ct_bob')) <> 'none' then raise exception 'relation should be none'; end if;
  if (select relation from public.find_user('ct_alice')) <> 'self' then raise exception 'relation should be self'; end if;
end $$;

-- ============================================================
-- 好友请求的各种路径
-- ============================================================
-- 不存在的用户 / 自己
call pg_temp.expect($$select public.send_friend_request('ct_nobody')$$, 'user_not_found');
call pg_temp.expect($$select public.send_friend_request('CT_Alice')$$, 'cannot_add_self');

-- alice -> bob：发送；重复发送被拒绝；bob 在好友请求里看得到 alice
do $$ begin
  if public.send_friend_request(' CT_Bob ') <> 'requested' then raise exception 'first request should be requested'; end if;
end $$;
call pg_temp.expect($$select public.send_friend_request('ct_bob')$$, 'request_already_sent');
do $$ begin
  if (select relation from public.find_user('ct_bob')) <> 'outgoing' then raise exception 'relation should be outgoing'; end if;
  -- 请求发出后，alice 能看到 bob 的资料
  if (select count(*) from public.profiles where id = 'c0000000-0000-0000-0000-00000000000b') <> 1 then
    raise exception 'requester should see addressee profile'; end if;
end $$;

-- 没有接受之前不能聊天
call pg_temp.expect($$select public.send_message('c0000000-0000-0000-0000-00000000000b', 'hi')$$, 'not_friends');

-- bob：能看到请求和 alice 的资料；只有被请求的一方能处理（发起人 alice 不行，第三人 carol 也不行）
call pg_temp.as_user('c0000000-0000-0000-0000-00000000000b');
do $$ begin
  if (select count(*) from public.friendships where status = 'pending' and addressee_id = auth.uid()) <> 1 then
    raise exception 'bob should see the incoming request'; end if;
  if (select relation from public.find_user('ct_alice')) <> 'incoming' then raise exception 'relation should be incoming'; end if;
  if (select count(*) from public.profiles where id = 'c0000000-0000-0000-0000-00000000000a') <> 1 then
    raise exception 'addressee should see requester profile'; end if;
end $$;

call pg_temp.as_user('c0000000-0000-0000-0000-00000000000a');
do $$
declare v_id bigint;
begin
  select id into v_id from public.friendships where addressee_id = 'c0000000-0000-0000-0000-00000000000b';
  if v_id is null then raise exception 'alice should see her outgoing request'; end if;
  call pg_temp.expect(format('select public.respond_friend_request(%s, true)', v_id), 'request_not_found');
end $$;
call pg_temp.as_user('c0000000-0000-0000-0000-00000000000c');
call pg_temp.expect('select public.respond_friend_request(999999999, true)', 'request_not_found');
do $$ begin
  if (select count(*) from public.friendships) <> 0 then raise exception 'carol must not see other people''s friendships'; end if;
end $$;

-- bob 拒绝；拒绝后 alice 还是不能发消息；bob 之后又能再被 alice 请求（重新请求）
call pg_temp.as_user('c0000000-0000-0000-0000-00000000000b');
do $$
declare v_id bigint;
begin
  select id into v_id from public.friendships where addressee_id = auth.uid() and status = 'pending';
  if public.respond_friend_request(v_id, false) <> 'declined' then raise exception 'should be declined'; end if;
  -- 已经处理过的请求不能再处理
  begin
    perform public.respond_friend_request(v_id, true);
    raise exception 'processed request must not be answerable again';
  exception when others then
    if sqlerrm <> 'request_not_found' then raise; end if;
  end;
end $$;
call pg_temp.as_user('c0000000-0000-0000-0000-00000000000a');
call pg_temp.expect($$select public.send_message('c0000000-0000-0000-0000-00000000000b', 'hi')$$, 'not_friends');
do $$ begin
  if (select relation from public.find_user('ct_bob')) <> 'none' then raise exception 'declined should show as none'; end if;
  if public.send_friend_request('ct_bob') <> 'requested' then raise exception 're-request after decline should work'; end if;
end $$;

-- bob 接受
call pg_temp.as_user('c0000000-0000-0000-0000-00000000000b');
do $$
declare v_id bigint;
begin
  select id into v_id from public.friendships where addressee_id = auth.uid() and status = 'pending';
  if public.respond_friend_request(v_id, true) <> 'accepted' then raise exception 'should be accepted'; end if;
end $$;
call pg_temp.expect($$select public.send_friend_request('ct_alice')$$, 'already_friends');
call pg_temp.as_user('c0000000-0000-0000-0000-00000000000a');
call pg_temp.expect($$select public.send_friend_request('ct_bob')$$, 'already_friends');

-- 反向请求自动通过：carol -> dave 之后 dave -> carol，直接变成好友；整个过程只有一行记录
call pg_temp.as_user('c0000000-0000-0000-0000-00000000000c');
do $$ begin
  if public.send_friend_request('ct_dave') <> 'requested' then raise exception 'carol request should be requested'; end if;
end $$;
call pg_temp.as_user('c0000000-0000-0000-0000-00000000000d');
do $$ begin
  if public.send_friend_request('ct_carol') <> 'accepted' then raise exception 'reverse request should auto-accept'; end if;
  if (select count(*) from public.friendships where status = 'accepted') <> 1 then raise exception 'dave should see exactly one accepted friendship'; end if;
end $$;
call pg_temp.as_user('c0000000-0000-0000-0000-00000000000c');
do $$ begin
  if (select count(*) from public.friendships where status = 'accepted') <> 1 then raise exception 'carol should see exactly one accepted friendship'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.friendships
      where least(requester_id, addressee_id) = 'c0000000-0000-0000-0000-00000000000c'
        and greatest(requester_id, addressee_id) = 'c0000000-0000-0000-0000-00000000000d') <> 1 then
    raise exception 'one row per pair';
  end if;
  -- 数据库层面也不允许同一对出现第二行（不分方向）
  begin
    insert into public.friendships (requester_id, addressee_id)
    values ('c0000000-0000-0000-0000-00000000000d', 'c0000000-0000-0000-0000-00000000000c');
    raise exception 'second row for the same pair must be rejected';
  exception when unique_violation then null;
  end;
end $$;

-- ============================================================
-- 消息：好友之间收发；非好友不行；已读只影响发给我的
-- ============================================================
call pg_temp.as_user('c0000000-0000-0000-0000-00000000000a');
call pg_temp.expect($$select public.send_message('c0000000-0000-0000-0000-00000000000c', 'hi stranger')$$, 'not_friends');
call pg_temp.expect($$select public.send_message('c0000000-0000-0000-0000-00000000000a', 'hi me')$$, 'not_friends');
call pg_temp.expect($$select public.send_message(null, 'hi')$$, 'not_friends');
call pg_temp.expect($$select public.send_message('c0000000-0000-0000-0000-00000000000b', '   ')$$, 'empty_message');
call pg_temp.expect($$select public.send_message('c0000000-0000-0000-0000-00000000000b', null)$$, 'empty_message');
call pg_temp.expect($$select public.send_message('c0000000-0000-0000-0000-00000000000b', repeat('a', 2001))$$, 'message_too_long');
do $$
declare m public.messages;
begin
  m := public.send_message('c0000000-0000-0000-0000-00000000000b', '  你好 bob  ');
  if m.body <> '你好 bob' or m.sender_id <> auth.uid() or m.read_at is not null then raise exception 'message not stored as expected'; end if;
  perform public.send_message('c0000000-0000-0000-0000-00000000000b', repeat('a', 2000));
  perform public.send_message('c0000000-0000-0000-0000-00000000000b', '第三条');
end $$;

-- bob 看到 3 条未读；会话列表里 alice 的未读数是 3、最后一条是"第三条"
call pg_temp.as_user('c0000000-0000-0000-0000-00000000000b');
do $$ begin
  if (select count(*) from public.messages) <> 3 then raise exception 'bob should see 3 messages'; end if;
  if (select unread_count from public.list_conversations() where peer_username = 'ct_alice') <> 3 then raise exception 'unread should be 3'; end if;
  if (select last_body from public.list_conversations() where peer_username = 'ct_alice') <> '第三条' then raise exception 'last message wrong'; end if;
  -- bob 回一条给 alice（这条 alice 之后不应被 bob 的 mark_read 影响）
  perform public.send_message('c0000000-0000-0000-0000-00000000000a', '收到');
end $$;

-- 第三人看不到这些消息；carol 对 alice 调 mark_read 什么也不会发生
call pg_temp.as_user('c0000000-0000-0000-0000-00000000000c');
do $$ begin
  if (select count(*) from public.messages) <> 0 then raise exception 'carol must not see alice/bob messages'; end if;
  if public.mark_read('c0000000-0000-0000-0000-00000000000a') <> 0 then raise exception 'carol mark_read should touch nothing'; end if;
  if public.mark_read('c0000000-0000-0000-0000-00000000000b') <> 0 then raise exception 'carol mark_read should touch nothing'; end if;
  if (select count(*) from public.list_conversations()) <> 1 then raise exception 'carol should only list dave'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.messages where read_at is not null) <> 0 then raise exception 'nothing should be read yet'; end if;
end $$;

-- alice 对 bob 调 mark_read：只会标记 bob 发给 alice 的那 1 条，不会动 alice 发给 bob 的 3 条
call pg_temp.as_user('c0000000-0000-0000-0000-00000000000a');
do $$ begin
  if public.mark_read('c0000000-0000-0000-0000-00000000000b') <> 1 then raise exception 'alice should mark exactly 1'; end if;
  if public.mark_read('c0000000-0000-0000-0000-00000000000b') <> 0 then raise exception 'second mark_read should be a no-op'; end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.messages where read_at is not null and receiver_id = 'c0000000-0000-0000-0000-00000000000a') <> 1 then
    raise exception 'bob->alice message should be read'; end if;
  if (select count(*) from public.messages where read_at is not null and receiver_id = 'c0000000-0000-0000-0000-00000000000b') <> 0 then
    raise exception 'alice->bob messages must stay unread'; end if;
end $$;
call pg_temp.as_user('c0000000-0000-0000-0000-00000000000b');
do $$ begin
  if public.mark_read('c0000000-0000-0000-0000-00000000000a') <> 3 then raise exception 'bob should mark 3'; end if;
  if (select unread_count from public.list_conversations() where peer_username = 'ct_alice') <> 0 then raise exception 'unread should be 0'; end if;
end $$;

-- ============================================================
-- 资料：昵称、头像路径
-- ============================================================
call pg_temp.as_user('c0000000-0000-0000-0000-00000000000a');
call pg_temp.expect($$select public.update_profile('', null)$$, 'invalid_nickname');
call pg_temp.expect($$select public.update_profile('   ', null)$$, 'invalid_nickname');
call pg_temp.expect($$select public.update_profile(repeat('字', 21), null)$$, 'invalid_nickname');
-- 头像路径必须在自己的目录下：别人的目录、根目录、带 ..、带 URL 都不行
call pg_temp.expect($$select public.update_profile(null, 'c0000000-0000-0000-0000-00000000000b/a.jpg')$$, 'invalid_avatar');
call pg_temp.expect($$select public.update_profile(null, 'a.jpg')$$, 'invalid_avatar');
call pg_temp.expect($$select public.update_profile(null, 'c0000000-0000-0000-0000-00000000000a/../x.jpg')$$, 'invalid_avatar');
call pg_temp.expect($$select public.update_profile(null, 'https://evil.example/t.png')$$, 'invalid_avatar');
call pg_temp.expect($$select public.update_profile(null, 'c0000000-0000-0000-0000-00000000000a/sub/a.jpg')$$, 'invalid_avatar');
do $$
declare p public.profiles;
begin
  p := public.update_profile('  新昵称  ', 'c0000000-0000-0000-0000-00000000000a/1700000000-a1b2.jpg');
  if p.nickname <> '新昵称' or p.avatar_path <> 'c0000000-0000-0000-0000-00000000000a/1700000000-a1b2.jpg' then raise exception 'update_profile result wrong'; end if;
  -- null 表示不修改
  p := public.update_profile(null, null);
  if p.nickname <> '新昵称' or p.avatar_path is null then raise exception 'null args should keep values'; end if;
  p := public.update_profile('只改昵称', null);
  if p.avatar_path is null then raise exception 'avatar should stay'; end if;
  -- 用户名不可变：没有任何入口能改
  if (select username from public.profiles where id = auth.uid()) <> 'ct_alice' then raise exception 'username must not change'; end if;
end $$;
reset role;
-- 表约束兜底（即使绕过函数，postgres 身份直接写也不行）
do $$ begin
  begin
    update public.profiles set avatar_path = 'c0000000-0000-0000-0000-00000000000b/a.jpg' where id = 'c0000000-0000-0000-0000-00000000000a';
    raise exception 'table constraint should reject foreign avatar path';
  exception when check_violation then null;
  end;
end $$;

-- ============================================================
-- RLS 兜底：就算给 authenticated 加了写权限，没有写 policy 也写不进去
-- ============================================================
grant insert, update, delete on public.messages, public.friendships, public.profiles to authenticated;
call pg_temp.as_user('c0000000-0000-0000-0000-00000000000a');
call pg_temp.expect($$insert into public.messages (sender_id, receiver_id, body) values ('c0000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-00000000000b','x')$$, 'new row violates row-level security policy for table "messages"');
call pg_temp.expect($$insert into public.friendships (requester_id, addressee_id) values ('c0000000-0000-0000-0000-00000000000a','c0000000-0000-0000-0000-00000000000c')$$, 'new row violates row-level security policy for table "friendships"');
call pg_temp.expect($$insert into public.profiles (id, username, nickname) values (gen_random_uuid(), 'ct_sneaky', 'x')$$, 'new row violates row-level security policy for table "profiles"');
do $$
declare n int;
begin
  update public.messages set body = 'edited';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'update on messages must affect 0 rows, got %', n; end if;
  delete from public.messages;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'delete on messages must affect 0 rows, got %', n; end if;
  update public.profiles set nickname = 'hacked';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'update on profiles must affect 0 rows, got %', n; end if;
  delete from public.friendships;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'delete on friendships must affect 0 rows, got %', n; end if;
end $$;
-- 未登录（anon）同样如此
reset role;
grant insert, update, delete on public.messages to anon;
call pg_temp.as_anon();
do $$ begin
  if (select count(*) from public.messages) <> 0 then raise exception 'anon must not read messages'; end if;
end $$;
reset role;
revoke insert, update, delete on public.messages, public.friendships, public.profiles from authenticated;
revoke insert, update, delete on public.messages from anon;

-- ============================================================
-- 存储：桶配置和对象 policy
-- ============================================================
do $$ begin
  if not exists (select 1 from storage.buckets where id = 'avatars' and public and file_size_limit <= 1048576
                 and allowed_mime_types @> array['image/jpeg']) then
    raise exception 'avatars bucket not configured as expected';
  end if;
end $$;

call pg_temp.as_user('c0000000-0000-0000-0000-00000000000a');
-- 自己的目录可以写、读、改、删
insert into storage.objects (bucket_id, name, owner) values ('avatars', 'c0000000-0000-0000-0000-00000000000a/one.jpg', 'c0000000-0000-0000-0000-00000000000a');
call pg_temp.expect($$insert into storage.objects (bucket_id, name) values ('avatars', 'c0000000-0000-0000-0000-00000000000b/evil.jpg')$$, 'new row violates row-level security policy for table "objects"');
call pg_temp.expect($$insert into storage.objects (bucket_id, name) values ('avatars', 'root.jpg')$$, 'new row violates row-level security policy for table "objects"');
reset role;
insert into storage.buckets (id, name) values ('ct_other_bucket', 'ct_other_bucket') on conflict do nothing;
insert into storage.objects (bucket_id, name) values ('avatars', 'c0000000-0000-0000-0000-00000000000b/bobs.jpg');
call pg_temp.as_user('c0000000-0000-0000-0000-00000000000a');
call pg_temp.expect($$insert into storage.objects (bucket_id, name) values ('ct_other_bucket', 'c0000000-0000-0000-0000-00000000000a/x.jpg')$$, 'new row violates row-level security policy for table "objects"');
do $$
declare n int;
begin
  if (select count(*) from storage.objects where bucket_id = 'avatars' and name like 'c0000000-%') <> 1 then
    raise exception 'alice should only see her own avatar objects'; end if;
  update storage.objects set name = 'c0000000-0000-0000-0000-00000000000b/stolen.jpg' where name like 'c0000000-0000-0000-0000-00000000000b/%';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'alice must not update bob''s objects'; end if;
  delete from storage.objects where name like 'c0000000-0000-0000-0000-00000000000b/%';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'alice must not delete bob''s objects'; end if;
end $$;
call pg_temp.expect($$update storage.objects set name = 'c0000000-0000-0000-0000-00000000000b/moved.jpg' where name = 'c0000000-0000-0000-0000-00000000000a/one.jpg'$$, 'new row violates row-level security policy for table "objects"');
delete from storage.objects where name = 'c0000000-0000-0000-0000-00000000000a/one.jpg';
call pg_temp.as_anon();
do $$ begin
  if (select count(*) from storage.objects where bucket_id = 'avatars') <> 0 then raise exception 'anon must not list avatars objects'; end if;
end $$;
call pg_temp.expect($$insert into storage.objects (bucket_id, name) values ('avatars', 'c0000000-0000-0000-0000-00000000000a/anon.jpg')$$, 'new row violates row-level security policy for table "objects"');
reset role;

-- 清理
delete from storage.objects where bucket_id = 'avatars' and name like 'c0000000-%';
delete from storage.buckets where id = 'ct_other_bucket';
delete from auth.users where email like '%@chat-test.local';
do $$ begin
  if exists (select 1 from public.profiles where username like 'ct\_%') then raise exception 'cleanup failed'; end if;
end $$;

select 'all chat tests passed';
