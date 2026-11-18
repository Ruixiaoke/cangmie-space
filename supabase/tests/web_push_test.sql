-- Web Push 订阅表的测试，CI 在临时 Postgres 上运行（.github/workflows/ci.yml）
-- 自带数据：开头清理上一次的测试用户，结尾再清理
\set ON_ERROR_STOP on
\set QUIET on

delete from auth.users where email like '%@push-test.local';

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
  ('d0000000-0000-0000-0000-00000000000a', 'pt_alice@push-test.local'),
  ('d0000000-0000-0000-0000-00000000000b', 'pt_bob@push-test.local');

-- 正常保存；同一个 endpoint 再保存是更新，不是新增
call pg_temp.as_user('d0000000-0000-0000-0000-00000000000a');
select public.save_push_subscription('https://push.example.com/a1', 'BPublicKeyPublicKeyPublicKey1', 'authsecret1', 'UA one');
select public.save_push_subscription('https://push.example.com/a1', 'BPublicKeyPublicKeyPublicKey2', 'authsecret2', 'UA two');
select public.save_push_subscription('https://push.example.com/a2', 'BPublicKeyPublicKeyPublicKey3', 'authsecret3', null);
do $$ begin
  if (select count(*) from public.push_subscriptions) <> 2 then raise exception 'alice should see exactly her 2 subscriptions'; end if;
  if (select p256dh from public.push_subscriptions where endpoint = 'https://push.example.com/a1') <> 'BPublicKeyPublicKeyPublicKey2' then
    raise exception 'upsert should update keys'; end if;
end $$;

-- 只能看到自己的行
call pg_temp.as_user('d0000000-0000-0000-0000-00000000000b');
do $$ begin
  if (select count(*) from public.push_subscriptions) <> 0 then raise exception 'bob must not see alice subscriptions'; end if;
end $$;

-- 不能直接写表，也不能读 push_log
call pg_temp.expect($$insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('d0000000-0000-0000-0000-00000000000b', 'https://x.example/y', 'a', 'b')$$, 'permission denied for table push_subscriptions');
call pg_temp.expect($$delete from public.push_subscriptions$$, 'permission denied for table push_subscriptions');
call pg_temp.expect($$select * from public.push_log$$, 'permission denied for table push_log');
reset role;

-- push_log 有数据时，普通用户也读不到；重复的 (kind, ref_id) 会冲突
insert into public.push_log (kind, ref_id) values ('message', 1);
do $$ begin
  begin
    insert into public.push_log (kind, ref_id) values ('message', 1);
    raise exception 'duplicate push_log row should conflict';
  exception when unique_violation then null; end;
end $$;
call pg_temp.as_user('d0000000-0000-0000-0000-00000000000b');

-- bob 删不掉 alice 的订阅
select public.delete_push_subscription('https://push.example.com/a2');
reset role;
do $$ begin
  if (select count(*) from public.push_subscriptions where user_id = 'd0000000-0000-0000-0000-00000000000a') <> 2 then
    raise exception 'bob must not delete alice subscriptions'; end if;
end $$;

-- bob 保存同一个 endpoint：归属改成 bob
call pg_temp.as_user('d0000000-0000-0000-0000-00000000000b');
select public.save_push_subscription('https://push.example.com/a2', 'BPublicKeyPublicKeyPublicKey4', 'authsecret4', 'UA bob');
do $$ begin
  if (select count(*) from public.push_subscriptions) <> 1 then raise exception 'bob should now own the reassigned endpoint'; end if;
end $$;
call pg_temp.as_user('d0000000-0000-0000-0000-00000000000a');
do $$ begin
  if (select count(*) from public.push_subscriptions) <> 1 then raise exception 'alice should have lost the reassigned endpoint'; end if;
end $$;

-- 校验：必须是 https，长度和字符集合法
call pg_temp.expect($$select public.save_push_subscription('http://push.example.com/x', 'BPublicKeyPublicKeyPublicKey1', 'authsecret1', null)$$, 'invalid_endpoint');
call pg_temp.expect($$select public.save_push_subscription('ftp://push.example.com/x', 'BPublicKeyPublicKeyPublicKey1', 'authsecret1', null)$$, 'invalid_endpoint');
call pg_temp.expect($$select public.save_push_subscription('https://a b', 'BPublicKeyPublicKeyPublicKey1', 'authsecret1', null)$$, 'invalid_endpoint');
call pg_temp.expect($$select public.save_push_subscription(null, 'BPublicKeyPublicKeyPublicKey1', 'authsecret1', null)$$, 'invalid_endpoint');
call pg_temp.expect($$select public.save_push_subscription('https://' || repeat('a', 2100), 'BPublicKeyPublicKeyPublicKey1', 'authsecret1', null)$$, 'invalid_endpoint');
call pg_temp.expect($$select public.save_push_subscription('https://push.example.com/x', 'short', 'authsecret1', null)$$, 'invalid_keys');
call pg_temp.expect($$select public.save_push_subscription('https://push.example.com/x', 'BPublicKeyPublicKeyPublicKey1', 'bad key!', null)$$, 'invalid_keys');
call pg_temp.expect($$select public.save_push_subscription('https://push.example.com/x', null, 'authsecret1', null)$$, 'invalid_keys');

-- 未登录：不能调用 RPC，也不能读表
call pg_temp.as_anon();
call pg_temp.expect($$select public.save_push_subscription('https://push.example.com/z', 'BPublicKeyPublicKeyPublicKey1', 'authsecret1', null)$$, 'permission denied for function save_push_subscription');
call pg_temp.expect($$select public.delete_push_subscription('https://push.example.com/a1')$$, 'permission denied for function delete_push_subscription');
-- （CI 里 anon 被补了默认 SELECT 权限，所以这里既可能被拒绝，也可能被 RLS 过滤成 0 行）
do $$ begin
  begin
    if (select count(*) from public.push_subscriptions) <> 0 then raise exception 'anon must not see subscriptions'; end if;
  exception when insufficient_privilege then null; end;
  begin
    if (select count(*) from public.push_log) <> 0 then raise exception 'anon must not see push_log'; end if;
  exception when insufficient_privilege then null; end;
end $$;

-- 已登录但 JWT 里没有用户：not_authenticated
reset role;
select set_config('request.jwt.claims', '', false);
set role authenticated;
call pg_temp.expect($$select public.save_push_subscription('https://push.example.com/z', 'BPublicKeyPublicKeyPublicKey1', 'authsecret1', null)$$, 'not_authenticated');
reset role;

-- 删除自己的订阅；删用户会级联删订阅
call pg_temp.as_user('d0000000-0000-0000-0000-00000000000a');
select public.delete_push_subscription('https://push.example.com/a1');
do $$ begin
  if (select count(*) from public.push_subscriptions) <> 0 then raise exception 'alice should have no subscriptions left'; end if;
end $$;
reset role;
delete from auth.users where email like '%@push-test.local';
delete from public.push_log where kind = 'message' and ref_id = 1;
do $$ begin
  if exists (select 1 from public.push_subscriptions where endpoint like 'https://push.example.com/%') then
    raise exception 'cleanup / cascade failed'; end if;
end $$;

select 'all web push tests passed';
