-- record_visit() 的测试，CI 在临时 Postgres 上运行（.github/workflows/ci.yml）
\set ON_ERROR_STOP on

set role anon;

-- 同一个 IP：x-forwarded-for 取第一个地址，次数累加
select set_config('request.headers', '{"x-forwarded-for":"203.0.113.7, 10.0.0.1"}', false);
do $$ begin
  if public.record_visit() <> 1 then raise exception 'first visit should return 1'; end if;
  if public.record_visit() <> 2 then raise exception 'second visit should return 2'; end if;
end $$;

-- cf-connecting-ip 优先于 x-forwarded-for，新 IP 从 1 开始
select set_config('request.headers', '{"cf-connecting-ip":"198.51.100.9","x-forwarded-for":"1.1.1.1"}', false);
do $$ begin
  if public.record_visit() <> 1 then raise exception 'new IP should start at 1'; end if;
end $$;

-- 没有请求头时记为 unknown，不报错
select set_config('request.headers', '', false);
do $$ begin
  if public.record_visit() <> 1 then raise exception 'missing headers should still work'; end if;
end $$;

-- anon 即使有表权限，也因为 RLS 读不到任何行
do $$ begin
  if (select count(*) from public.visits) <> 0 then raise exception 'anon must not be able to read visits'; end if;
end $$;

reset role;

do $$ begin
  if not exists (select 1 from public.visits where ip = '203.0.113.7' and count = 2) then
    raise exception 'x-forwarded-for first hop not stored correctly';
  end if;
  if not exists (select 1 from public.visits where ip = '198.51.100.9' and count = 1) then
    raise exception 'cf-connecting-ip not preferred';
  end if;
  if not exists (select 1 from public.visits where ip = 'unknown') then
    raise exception 'missing headers should be stored as unknown';
  end if;
end $$;

select 'all record_visit tests passed';
