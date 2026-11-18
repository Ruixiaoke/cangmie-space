-- 聊天小程序的 Web Push：保存浏览器的推送订阅，以及推送去重日志
-- 由 GitHub Actions（.github/workflows/backend.yml）自动执行；可重复运行
--
-- push_subscriptions：用户只能读自己的行，写入都走下面的 security definer 函数
-- push_log：只给 Edge Function（平台管理员角色）使用，开了 RLS 且没有任何 policy

-- ============================================================
-- 表
-- ============================================================

create table if not exists public.push_subscriptions (
  id           bigint generated always as identity primary key,
  user_id      uuid        not null references public.profiles (id) on delete cascade,
  endpoint     text        not null unique,
  p256dh       text        not null,
  auth         text        not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- 已经推送过的事件（kind = message / friend_request / friend_accepted），避免重复推送
create table if not exists public.push_log (
  kind       text        not null,
  ref_id     bigint      not null,
  created_at timestamptz not null default now(),
  primary key (kind, ref_id)
);

-- ============================================================
-- 权限和 RLS
-- ============================================================

revoke all on table public.push_subscriptions, public.push_log from public, anon, authenticated;
grant select on table public.push_subscriptions to authenticated;

alter table public.push_subscriptions enable row level security;
alter table public.push_log           enable row level security;

drop policy if exists push_subscriptions_select_own on public.push_subscriptions;
create policy push_subscriptions_select_own on public.push_subscriptions
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Edge Function 用平台的管理员角色访问这两张表；不依赖默认权限，显式授权
-- （角色名拼接生成，本地 CI 的裸 Postgres 里没有这个角色时跳过）
do $$
declare
  v_role text := 'service' || '_role';
begin
  if exists (select 1 from pg_roles where rolname = v_role) then
    execute format('grant select, insert, update, delete on table public.push_subscriptions, public.push_log to %I', v_role);
  end if;
end $$;

-- ============================================================
-- RPC
-- ============================================================

-- 保存（或更新）当前用户的推送订阅；同一个 endpoint 重复保存会改归属到当前用户
create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://[^[:space:]]+$' or char_length(p_endpoint) > 2048 then
    raise exception 'invalid_endpoint';
  end if;
  if p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{20,200}$'
     or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{8,100}$' then
    raise exception 'invalid_keys';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_me, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent;
end;
$$;

revoke execute on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- 删除当前用户自己的订阅（别人的订阅不会受影响）
create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  delete from public.push_subscriptions s where s.endpoint = p_endpoint and s.user_id = v_me;
end;
$$;

revoke execute on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.delete_push_subscription(text) to authenticated;
