-- 由 GitHub Actions（.github/workflows/backend.yml）自动执行；也可以手动在 SQL Editor 里运行

-- 每个 IP 一行：访问次数、第一次和最近一次访问时间
create table if not exists public.visits (
  ip          text primary key,
  count       integer     not null default 0,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

-- 打开 RLS 且不加任何 policy：前端的 anon key 不能直接读写这张表
alter table public.visits enable row level security;

-- 前端唯一能调用的入口：记录一次访问，返回这个 IP 的累计次数
-- IP 从请求头里取（不信任前端传参），security definer 让函数能写表
create or replace function public.record_visit()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  h   json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
  v_ip text;
  v_n  integer;
begin
  v_ip := coalesce(
    nullif(h->>'cf-connecting-ip', ''),
    nullif(h->>'x-real-ip', ''),
    nullif(trim(split_part(h->>'x-forwarded-for', ',', 1)), ''),
    'unknown'
  );

  insert into public.visits as v (ip, count)
  values (v_ip, 1)
  on conflict (ip) do update
    set count = v.count + 1,
        last_seen = now()
  returning v.count into v_n;

  return v_n;
end;
$$;

revoke all on function public.record_visit() from public;
grant execute on function public.record_visit() to anon;

-- 想看记录时在 SQL Editor 里运行：
-- select * from public.visits order by last_seen desc;
