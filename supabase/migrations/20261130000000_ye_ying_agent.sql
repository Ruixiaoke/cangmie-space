alter table public.messages drop constraint if exists messages_author_valid;
alter table public.messages add constraint messages_author_valid
  check (author is null or author in ('durian', 'ye_ying'));

alter table public.agent_jobs add column if not exists agent_id text not null default 'durian'
  check (agent_id in ('durian', 'ye_ying'));

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

  -- 同一个人的并发提问排队，限额和去重才准
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
  if (select count(*) from public.agent_jobs j
       where j.asker = v_me and j.created_at > now() - interval '24 hours') >= 50 then
    raise exception 'agent_rate_limited';
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
