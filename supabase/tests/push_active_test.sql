-- 前台设备不推送（set_push_active）的测试，CI 在临时 Postgres 上运行（.github/workflows/ci.yml）
-- 自带数据：开头清理上一次的测试用户，结尾再清理
\set ON_ERROR_STOP on
\set QUIET on

delete from auth.users where email like '%@pushact-test.local';

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
  ('d1000000-0000-0000-0000-00000000000a', 'pa_alice@pushact-test.local'),
  ('d1000000-0000-0000-0000-00000000000b', 'pa_bob@pushact-test.local');

call pg_temp.as_user('d1000000-0000-0000-0000-00000000000a');
select public.save_push_subscription('https://push.example.com/pa1', 'BPublicKeyPublicKeyPublicKey1', 'authsecret1', null);
select public.save_push_subscription('https://push.example.com/pa2', 'BPublicKeyPublicKeyPublicKey2', 'authsecret2', null);
call pg_temp.as_user('d1000000-0000-0000-0000-00000000000b');
select public.save_push_subscription('https://push.example.com/pb1', 'BPublicKeyPublicKeyPublicKey3', 'authsecret3', null);

-- 刚保存的订阅不活跃
reset role;
do $$ begin
  if exists (select 1 from public.push_subscriptions where endpoint like 'https://push.example.com/p%' and active_until is not null) then
    raise exception 'new subscriptions must not be active'; end if;
end $$;

-- alice 标记 pa1 活跃：只有 pa1 变化，大约 45 秒后到期
call pg_temp.as_user('d1000000-0000-0000-0000-00000000000a');
select public.set_push_active('https://push.example.com/pa1', true);
reset role;
do $$ begin
  if not exists (select 1 from public.push_subscriptions where endpoint = 'https://push.example.com/pa1'
                 and active_until > now() + interval '30 seconds' and active_until <= now() + interval '60 seconds') then
    raise exception 'pa1 should be active for about 45 seconds'; end if;
  if exists (select 1 from public.push_subscriptions where endpoint in ('https://push.example.com/pa2', 'https://push.example.com/pb1') and active_until is not null) then
    raise exception 'other subscriptions must stay inactive'; end if;
end $$;

-- bob 不能改 alice 的订阅（静默无效）
call pg_temp.as_user('d1000000-0000-0000-0000-00000000000b');
select public.set_push_active('https://push.example.com/pa2', true);
select public.set_push_active('https://push.example.com/pa1', false);
reset role;
do $$ begin
  if (select active_until from public.push_subscriptions where endpoint = 'https://push.example.com/pa2') is not null then
    raise exception 'bob must not activate alice subscription'; end if;
  if (select active_until from public.push_subscriptions where endpoint = 'https://push.example.com/pa1') is null then
    raise exception 'bob must not deactivate alice subscription'; end if;
end $$;

-- alice 取消活跃；null 按取消处理
call pg_temp.as_user('d1000000-0000-0000-0000-00000000000a');
select public.set_push_active('https://push.example.com/pa1', false);
select public.set_push_active('https://push.example.com/pa2', true);
select public.set_push_active('https://push.example.com/pa2', null);
reset role;
do $$ begin
  if exists (select 1 from public.push_subscriptions where endpoint like 'https://push.example.com/pa%' and active_until is not null) then
    raise exception 'alice subscriptions should be inactive again'; end if;
end $$;

-- 未登录不能调用；JWT 里没有用户时报 not_authenticated；不能直接改表
call pg_temp.as_anon();
call pg_temp.expect($$select public.set_push_active('https://push.example.com/pa1', true)$$, 'permission denied for function set_push_active');
reset role;
select set_config('request.jwt.claims', '', false);
set role authenticated;
call pg_temp.expect($$select public.set_push_active('https://push.example.com/pa1', true)$$, 'not_authenticated');
call pg_temp.expect($$update public.push_subscriptions set active_until = now() + interval '1 day'$$, 'permission denied for table push_subscriptions');
reset role;

delete from auth.users where email like '%@pushact-test.local';
do $$ begin
  if exists (select 1 from public.push_subscriptions where endpoint like 'https://push.example.com/p%') then
    raise exception 'cleanup / cascade failed'; end if;
end $$;

select 'all push active tests passed';
