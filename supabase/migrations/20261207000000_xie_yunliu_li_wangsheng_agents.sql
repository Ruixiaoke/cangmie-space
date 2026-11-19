-- 新 agent：谢云流（xie_yunliu）、李忘生（li_wangsheng）。顺便把写死在各处的 agent 名单集中到三个函数里：
--   agent_ids()                  所有 agent 的 id（messages.author、agent_jobs / 记忆表的 agent_id、groups.agents 都按它校验）
--   agent_mentioned(id, 消息)    这条消息有没有 @ 到这个 agent（agent_ask / agent_ask_group 用）
--   group_agent_name(id)         群里系统提示行用的中文名
-- 以后再加 agent：新迁移里 create or replace 这三个函数即可，约束和 agent_ask 不用再改（见 .claude/skills/chat-agent/SKILL.md）。
-- 由 GitHub Actions 自动执行；可重复运行

create or replace function public.agent_ids()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['durian', 'ye_ying', 'xie_yunliu', 'li_wangsheng']::text[];
$$;

create or replace function public.agent_mentioned(p_agent text, p_body text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(case p_agent
    when 'durian'     then p_body ~ '[@＠](沈剑心|榴莲)'
    when 'ye_ying'    then p_body ~ '[@＠]叶英'
    when 'xie_yunliu' then p_body ~ '[@＠]谢云流'
    when 'li_wangsheng' then p_body ~ '[@＠]李忘生'
    else false
  end, false);
$$;

create or replace function public.group_agent_name(p_agent text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_agent
    when 'ye_ying'    then '叶英'
    when 'xie_yunliu' then '谢云流'
    when 'li_wangsheng' then '李忘生'
    else '沈剑心'
  end;
$$;

-- agent_ids / agent_mentioned 不收回 public 的执行权限：表上的 check 约束会调用它们，
-- 写消息的各个角色（security definer 函数的属主、Edge Function 的 service role）都要能执行。它们只返回常量和正则判断，没有数据。
revoke execute on function public.group_agent_name(text) from public, anon, authenticated;

-- ============================================================
-- 约束：改成按 agent_ids() 校验（旧约束是列上的匿名约束，名字是 Postgres 自动起的）
-- ============================================================

alter table public.messages drop constraint if exists messages_author_valid;
alter table public.messages add constraint messages_author_valid
  check (author is null or author = 'system' or author = any(public.agent_ids()));

alter table public.agent_jobs drop constraint if exists agent_jobs_agent_id_check;
alter table public.agent_jobs drop constraint if exists agent_jobs_agent_valid;
alter table public.agent_jobs add constraint agent_jobs_agent_valid check (agent_id = any(public.agent_ids()));

alter table public.agent_memories drop constraint if exists agent_memories_agent_id_check;
alter table public.agent_memories drop constraint if exists agent_memories_agent_valid;
alter table public.agent_memories add constraint agent_memories_agent_valid check (agent_id = any(public.agent_ids()));

alter table public.agent_group_memories drop constraint if exists agent_group_memories_agent_id_check;
alter table public.agent_group_memories drop constraint if exists agent_group_memories_agent_valid;
alter table public.agent_group_memories add constraint agent_group_memories_agent_valid check (agent_id = any(public.agent_ids()));

alter table public.groups drop constraint if exists groups_agents_valid;
alter table public.groups add constraint groups_agents_valid check (agents <@ public.agent_ids());

-- ============================================================
-- 提问和群开关：同签名 create or replace，名单改读上面的函数
-- ============================================================

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

  -- 同一个人的并发提问排队，限额（和私聊共用）和去重才准
  perform pg_advisory_xact_lock(hashtextextended('agent_ask:' || v_me::text, 0));

  update public.agent_jobs j
     set status = 'failed', error = 'timeout', updated_at = now()
   where j.group_id = v_msg.group_id and j.agent_id = p_agent_id and j.status in ('pending', 'running')
     and j.updated_at < now() - interval '3 minutes';

  if exists (select 1 from public.agent_jobs j where j.message_id = p_message and j.agent_id = p_agent_id) then
    raise exception 'agent_busy';
  end if;
  if (select count(*) from public.agent_jobs j
       where j.asker = v_me and j.created_at > now() - interval '24 hours') >= 50 then
    raise exception 'agent_rate_limited';
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

create or replace function public.set_group_agents(p_group bigint, p_agents text[])
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := auth.uid();
  v_old  text[];
  v_new  text[];
  v_a    text;
  v_g    public.groups;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select g.agents into v_old from public.groups g where g.id = p_group for update;
  if not found or not exists (select 1 from public.group_members gm where gm.group_id = p_group and gm.user_id = v_me) then
    raise exception 'not_group_member';
  end if;
  select coalesce(array_agg(distinct x order by x), '{}') into v_new from unnest(coalesce(p_agents, '{}')) as x;
  if not (v_new <@ public.agent_ids()) then
    raise exception 'invalid_argument';
  end if;

  update public.groups g set agents = v_new, updated_at = now() where g.id = p_group returning * into v_g;
  foreach v_a in array public.agent_ids() loop
    if v_a = any(v_new) and not (v_a = any(v_old)) then
      perform public.group_system_line(p_group, v_me, public.group_nick(v_me) || ' 打开了' || public.group_agent_name(v_a));
    elsif v_a = any(v_old) and not (v_a = any(v_new)) then
      perform public.group_system_line(p_group, v_me, public.group_nick(v_me) || ' 关掉了' || public.group_agent_name(v_a));
    end if;
  end loop;
  return v_g;
end;
$$;
