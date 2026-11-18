alter table public.agent_jobs drop constraint if exists agent_jobs_message_id_key;
create unique index if not exists agent_jobs_message_agent_uq on public.agent_jobs (message_id, agent_id);
drop index if exists public.agent_jobs_one_active;
create unique index agent_jobs_one_active
  on public.agent_jobs (least(asker, peer), greatest(asker, peer), agent_id)
  where status in ('pending', 'running');

alter table public.agent_memories add column if not exists agent_id text not null default 'durian'
  check (agent_id in ('durian', 'ye_ying'));
drop index if exists public.agent_memories_pair_title_uq;
create unique index agent_memories_pair_title_uq on public.agent_memories (user_lo, user_hi, agent_id, title);

create or replace function public.agent_memories_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and not exists (
       select 1 from public.agent_memories m where m.user_lo = new.user_lo and m.user_hi = new.user_hi and m.agent_id = new.agent_id and m.title = new.title)
     and (select count(*) from public.agent_memories m where m.user_lo = new.user_lo and m.user_hi = new.user_hi and m.agent_id = new.agent_id) >= 200 then
    raise exception 'memory_full';
  end if;
  if new.pinned and (select count(*) from public.agent_memories m
                      where m.user_lo = new.user_lo and m.user_hi = new.user_hi and m.agent_id = new.agent_id and m.pinned and m.title <> new.title) >= 10 then
    raise exception 'pinned_full';
  end if;
  return new;
end;
$$;

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
  if p_agent_id is null
     or not ((p_agent_id = 'durian' and v_msg.body ~ '[@＠](沈剑心|榴莲)')
          or (p_agent_id = 'ye_ying' and v_msg.body ~ '[@＠]叶英')) then
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
   where j.agent_id = p_agent_id and j.status in ('pending', 'running')
     and j.updated_at < now() - interval '3 minutes'
     and least(j.asker, j.peer) = least(v_me, v_msg.receiver_id)
     and greatest(j.asker, j.peer) = greatest(v_me, v_msg.receiver_id);

  if exists (select 1 from public.agent_jobs j where j.message_id = p_message and j.agent_id = p_agent_id) then
    raise exception 'agent_busy';
  end if;
  if (select count(*) from public.agent_jobs j
       where j.asker = v_me and j.created_at > now() - interval '24 hours') >= 50 then
    raise exception 'agent_rate_limited';
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

create or replace function public.agent_search_messages(p_a uuid, p_b uuid, p_query text, p_limit integer, p_before bigint)
returns table (id bigint, sender_id uuid, author text, body text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.sender_id, m.author, left(m.body, 300), m.created_at
  from public.messages m
  where ((m.sender_id = p_a and m.receiver_id = p_b) or (m.sender_id = p_b and m.receiver_id = p_a))
    and m.id < p_before
    and m.body ilike '%' || replace(replace(replace(left(coalesce(p_query, ''), 100), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
    and btrim(coalesce(p_query, '')) <> ''
  order by m.id desc
  limit greatest(1, least(coalesce(p_limit, 5), 10));
$$;

revoke execute on function public.agent_search_messages(uuid, uuid, text, integer, bigint) from public, anon, authenticated;
do $$
declare
  v_role text := 'service' || '_role';
begin
  if exists (select 1 from pg_roles where rolname = v_role) then
    execute format('grant execute on function public.agent_search_messages(uuid, uuid, text, integer, bigint) to %I', v_role);
  end if;
end $$;
