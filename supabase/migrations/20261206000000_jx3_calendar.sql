-- 剑三日常缓存：GitHub Actions（.github/workflows/jx3-calendar.yml）每天早上从第三方 JX3API 抓今天起 7 天的日常写进来，
-- agent-chat 的 jx3_info 工具查日常时先读这里（JX3API 服务器在大陆，从海外访问常要 5 到 10 秒甚至超时）。
-- 库里没有某天时，函数会现查一次并写回。只有 service role 和迁移用的 postgres 角色能读写，用户看不到。
-- 由 GitHub Actions 自动执行；可重复运行

create table if not exists public.jx3_calendar (
  date        date        primary key,
  data        jsonb       not null,
  fetched_at  timestamptz not null default now()
);

alter table public.jx3_calendar enable row level security;
revoke all on table public.jx3_calendar from public, anon, authenticated;

do $$
declare
  v_role text := 'service' || '_role';
begin
  if exists (select 1 from pg_roles where rolname = v_role) then
    execute format('grant select, insert, update on table public.jx3_calendar to %I', v_role);
  end if;
end $$;
