-- 取消助手的提问次数限制（原来每人 24 小时 50 次，所有助手共用）。
-- agent_ask / agent_ask_group 整段复制自 20261207000000_xie_yunliu_li_wangsheng_agents.sql，只删掉了限额那一段。
-- 旧的单参数 agent_ask(bigint)（没刷新的旧页面还在用）整段复制自 20261130000000_ye_ying_agent.sql，同样只删掉限额。
-- 由 GitHub Actions 自动执行；可重复运行

create or replace function public.agent_ask(p_message bigint, p_agent_id text)
returns public.agent_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me  uuid := auth.uid();
  v_msg public.messages;
  v_job public.agent_jobs;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_msg from public.messages m where m.id = p_message;
  if not found or v_msg.sender_id <> v_me or v_msg.author is not null then
    raise exception 'agent_forbidden';
  end if;
  if p_agent_id is null or not public.agent_mentioned(p_agent_id, v_msg.body) then
    raise exception 'agent_not_mentioned';
  end if;
  if v_msg.created_at < now() - interval '10 minutes' then
    raise exception 'agent_too_old';
  end if;
  if not exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and least(f.requester_id, f.addressee_id) = least(v_me, v_msg.receiver_id)
      and greatest(f.requester_id, f.addressee_id) = greatest(v_me, v_msg.receiver_id)
  ) then
    raise exception 'not_friends';
  end if;

  -- 同一个人的并发提问排队，去重才准
  perform pg_advisory_xact_lock(hashtextextended('agent_ask:' || v_me::text, 0));

  -- 卡住的任务（函数被平台杀掉等）3 分钟后算失败，不再挡住这一对好友
  update public.agent_jobs j
     set status = 'failed', error = 'timeout', updated_at = now()
   where j.agent_id = p_agent_id and j.status in ('pending', 'running')
     and j.updated_at < now() - interval '3 minutes'
     and least(j.asker, j.peer) = least(v_me, v_msg.receiver_id)
     and greatest(j.asker, j.peer) = greatest(v_me, v_msg.receiver_id);

  if exists (select 1 from public.agent_jobs j where j.message_id = p_message and j.agent_id = p_agent_id) then
    raise exception 'agent_busy';
  end if;
  if exists (
    select 1 from public.agent_jobs j
    where j.agent_id = p_agent_id and j.status in ('pending', 'running')
      and least(j.asker, j.peer) = least(v_me, v_msg.receiver_id)
      and greatest(j.asker, j.peer) = greatest(v_me, v_msg.receiver_id)
  ) then
    raise exception 'agent_busy';
  end if;

  insert into public.agent_jobs (asker, peer, message_id, agent_id)
  values (v_me, v_msg.receiver_id, p_message, p_agent_id)
  on conflict do nothing
  returning * into v_job;
  if not found then
    raise exception 'agent_busy';
  end if;
  return v_job;
end;
$$;

revoke execute on function public.agent_ask(bigint, text) from public, anon;
grant execute on function public.agent_ask(bigint, text) to authenticated;

create or replace function public.agent_ask_group(p_message bigint, p_agent_id text)
returns public.agent_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me  uuid := auth.uid();
  v_msg public.messages;
  v_job public.agent_jobs;
  v_g   public.groups;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_msg from public.messages m where m.id = p_message;
  if not found or v_msg.sender_id <> v_me or v_msg.author is not null or v_msg.group_id is null then
    raise exception 'agent_forbidden';
  end if;
  if not exists (select 1 from public.group_members gm where gm.group_id = v_msg.group_id and gm.user_id = v_me) then
    raise exception 'not_group_member';
  end if;
  if p_agent_id is null or not public.agent_mentioned(p_agent_id, v_msg.body) then
    raise exception 'agent_not_mentioned';
  end if;
  if v_msg.created_at < now() - interval '10 minutes' then
    raise exception 'agent_too_old';
  end if;
  select * into v_g from public.groups g where g.id = v_msg.group_id;
  if not (p_agent_id = any(v_g.agents)) then
    raise exception 'agent_not_enabled';
  end if;

  -- 同一个人的并发提问排队，去重才准
  perform pg_advisory_xact_lock(hashtextextended('agent_ask:' || v_me::text, 0));

  update public.agent_jobs j
     set status = 'failed', error = 'timeout', updated_at = now()
   where j.group_id = v_msg.group_id and j.agent_id = p_agent_id and j.status in ('pending', 'running')
     and j.updated_at < now() - interval '3 minutes';

  if exists (select 1 from public.agent_jobs j where j.message_id = p_message and j.agent_id = p_agent_id) then
    raise exception 'agent_busy';
  end if;
  if exists (
    select 1 from public.agent_jobs j
    where j.group_id = v_msg.group_id and j.agent_id = p_agent_id and j.status in ('pending', 'running')
  ) then
    raise exception 'agent_busy';
  end if;

  insert into public.agent_jobs (asker, group_id, message_id, agent_id)
  values (v_me, v_msg.group_id, p_message, p_agent_id)
  on conflict do nothing
  returning * into v_job;
  if not found then
    raise exception 'agent_busy';
  end if;
  return v_job;
end;
$$;

revoke execute on function public.agent_ask_group(bigint, text) from public, anon;
grant execute on function public.agent_ask_group(bigint, text) to authenticated;

create or replace function public.agent_ask(p_message bigint)
returns public.agent_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me  uuid := auth.uid();
  v_msg public.messages;
  v_job public.agent_jobs;
  v_mention text;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_msg from public.messages m where m.id = p_message;
  if not found or v_msg.sender_id <> v_me or v_msg.author is not null then
    raise exception 'agent_forbidden';
  end if;
  v_mention := substring(v_msg.body from '[@＠](沈剑心|榴莲|叶英)');
  if v_mention is null then
    raise exception 'agent_not_mentioned';
  end if;
  if v_msg.created_at < now() - interval '10 minutes' then
    raise exception 'agent_too_old';
  end if;
  if not exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and least(f.requester_id, f.addressee_id) = least(v_me, v_msg.receiver_id)
      and greatest(f.requester_id, f.addressee_id) = greatest(v_me, v_msg.receiver_id)
  ) then
    raise exception 'not_friends';
  end if;

  -- 同一个人的并发提问排队，去重才准
  perform pg_advisory_xact_lock(hashtextextended('agent_ask:' || v_me::text, 0));

  -- 卡住的任务（函数被平台杀掉等）3 分钟后算失败，不再挡住这一对好友
  update public.agent_jobs j
     set status = 'failed', error = 'timeout', updated_at = now()
   where j.status in ('pending', 'running')
     and j.updated_at < now() - interval '3 minutes'
     and least(j.asker, j.peer) = least(v_me, v_msg.receiver_id)
     and greatest(j.asker, j.peer) = greatest(v_me, v_msg.receiver_id);

  if exists (select 1 from public.agent_jobs j where j.message_id = p_message) then
    raise exception 'agent_busy';
  end if;
  if exists (
    select 1 from public.agent_jobs j
    where j.status in ('pending', 'running')
      and least(j.asker, j.peer) = least(v_me, v_msg.receiver_id)
      and greatest(j.asker, j.peer) = greatest(v_me, v_msg.receiver_id)
  ) then
    raise exception 'agent_busy';
  end if;

  insert into public.agent_jobs (asker, peer, message_id, agent_id)
  values (v_me, v_msg.receiver_id, p_message, case when v_mention = '叶英' then 'ye_ying' else 'durian' end)
  returning * into v_job;
  return v_job;
end;
$$;

revoke execute on function public.agent_ask(bigint) from public, anon;
grant execute on function public.agent_ask(bigint) to authenticated;
