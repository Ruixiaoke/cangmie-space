-- Web Push：设备在前台时不推送
-- 页面可见时，客户端每隔一会儿调用 set_push_active 把自己这台设备的订阅标记为"活跃"（active_until 往后推），
-- 页面隐藏时清掉；send-push 跳过 active_until 还没到期的订阅。同一用户的其他设备不受影响。
-- 由 GitHub Actions（.github/workflows/backend.yml）自动执行；可重复运行

alter table public.push_subscriptions add column if not exists active_until timestamptz;

-- 标记（或取消标记）当前用户自己的某个订阅为活跃；只会改自己的行，endpoint 不存在或不是自己的就什么都不做
create or replace function public.set_push_active(p_endpoint text, p_active boolean)
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
  update public.push_subscriptions s
     set active_until = case when coalesce(p_active, false) then now() + interval '45 seconds' else null end
   where s.endpoint = p_endpoint and s.user_id = v_me;
end;
$$;

revoke execute on function public.set_push_active(text, boolean) from public, anon;
grant execute on function public.set_push_active(text, boolean) to authenticated;
