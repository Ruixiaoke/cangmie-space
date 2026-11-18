-- 引用回复（messages.reply_to、send_message 的 p_reply_to）的测试，CI 在临时 Postgres 上运行
-- 自带数据：开头清理上一次的测试用户，结尾再清理
\set ON_ERROR_STOP on
\set QUIET on

delete from auth.users where email like '%@quote-test.local';

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
  ('e0000000-0000-0000-0000-00000000000a', 'qt_alice@quote-test.local'),
  ('e0000000-0000-0000-0000-00000000000b', 'qt_bob@quote-test.local'),
  ('e0000000-0000-0000-0000-00000000000c', 'qt_carol@quote-test.local');

-- alice 和 bob、alice 和 carol 是好友；bob 和 carol 不是
insert into public.friendships (requester_id, addressee_id, status) values
  ('e0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-00000000000b', 'accepted'),
  ('e0000000-0000-0000-0000-00000000000a', 'e0000000-0000-0000-0000-00000000000c', 'accepted');

-- 匿名不能调用（两参数和三参数都不行）
call pg_temp.as_anon();
call pg_temp.expect($$select public.send_message('e0000000-0000-0000-0000-00000000000b', 'hi')$$, 'permission denied for function send_message');
call pg_temp.expect($$select public.send_message('e0000000-0000-0000-0000-00000000000b', 'hi', 1)$$, 'permission denied for function send_message');

-- 只剩一个 send_message（没有两个重载）
reset role;
do $$ begin
  if (select count(*) from pg_proc where proname = 'send_message' and pronamespace = 'public'::regnamespace) <> 1 then
    raise exception 'send_message must have exactly one overload'; end if;
end $$;

-- alice：两参数调用照常可用，reply_to 为空；null 也可以
call pg_temp.as_user('e0000000-0000-0000-0000-00000000000a');
do $$
declare m public.messages;
begin
  m := public.send_message('e0000000-0000-0000-0000-00000000000b', 'first');
  if m.reply_to is not null then raise exception 'two-arg call should have null reply_to'; end if;
  m := public.send_message('e0000000-0000-0000-0000-00000000000b', 'second', null);
  if m.reply_to is not null then raise exception 'null reply_to should stay null'; end if;
  m := public.send_message(p_peer => 'e0000000-0000-0000-0000-00000000000b', p_body => 'named two-arg');
  if m.reply_to is not null then raise exception 'named two-arg call should work'; end if;
  perform public.send_message('e0000000-0000-0000-0000-00000000000c', 'hello carol');
end $$;

-- bob 引用 alice 的消息（对方发的），再引用自己的消息
call pg_temp.as_user('e0000000-0000-0000-0000-00000000000b');
do $$
declare q bigint; m public.messages; m2 public.messages;
begin
  select id into q from public.messages where body = 'first';
  m := public.send_message('e0000000-0000-0000-0000-00000000000a', 'reply to first', q);
  if m.reply_to is distinct from q then raise exception 'reply_to not returned'; end if;
  if (select reply_to from public.messages where id = m.id) is distinct from q then raise exception 'reply_to not stored'; end if;
  m2 := public.send_message('e0000000-0000-0000-0000-00000000000a', 'reply to myself', m.id);
  if m2.reply_to is distinct from m.id then raise exception 'quoting own message should work'; end if;
end $$;

-- 引用别的会话里的消息：被拒绝（bob 看不到 alice 和 carol 的聊天，id 不存在同理）
call pg_temp.as_user('e0000000-0000-0000-0000-00000000000a');
do $$
declare q bigint;
begin
  select id into q from public.messages where body = 'hello carol';
  begin
    perform public.send_message('e0000000-0000-0000-0000-00000000000b', 'sneaky', q);
    raise exception 'quoting another conversation should be rejected';
  exception when others then
    if sqlerrm <> 'invalid_reply' then raise; end if;
  end;
end $$;
call pg_temp.expect($$select public.send_message('e0000000-0000-0000-0000-00000000000b', 'ghost', 999999999)$$, 'invalid_reply');
-- 原有检查先于引用检查
call pg_temp.expect($$select public.send_message('e0000000-0000-0000-0000-00000000000b', '   ', 1)$$, 'empty_message');

-- 删除被引用的消息：reply_to 置空，回复本身保留
reset role;
do $$
declare q bigint; r bigint;
begin
  select id into q from public.messages where body = 'first';
  select id into r from public.messages where body = 'reply to first';
  delete from public.messages where id = q;
  if not exists (select 1 from public.messages where id = r and reply_to is null) then
    raise exception 'reply_to should be set to null when the quoted message is deleted'; end if;
end $$;

-- 清理
delete from auth.users where email like '%@quote-test.local';
do $$ begin
  if exists (select 1 from public.messages m join public.profiles p on p.id in (m.sender_id, m.receiver_id) where p.username like 'qt\_%') then
    raise exception 'cleanup failed'; end if;
end $$;

select 'all quote reply tests passed';
