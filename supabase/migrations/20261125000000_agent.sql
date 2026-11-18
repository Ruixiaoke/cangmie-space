-- 聊天小程序：榴莲（Durian），住在 1:1 聊天里的 AI 助手
-- 由 GitHub Actions（.github/workflows/backend.yml）自动执行；可重复运行
--
-- 榴莲不是用户：它的回复是 messages 里 author = 'durian' 的普通行（sender_id = 提问的人，receiver_id = 对方），
-- 只有 Edge Function（平台管理员角色）能写；两边的前端看到 author 就把它渲染成第三个参与者。
--   messages.author    谁写的；null = 真人。用户没有任何直接写 messages 的权限，触发器再兜一层底
--   agent_jobs         一次提问 = 一个任务（pending -> running -> done / failed），双方可读，只有函数能写
--   agent_memories     榴莲对这一对好友的长期记忆（两人共用），只有函数能写
--   agent_ask(消息)    提问者调用：校验、限额（24 小时 50 次）、同一对好友同时只有一个进行中的任务
--   agent_search_messages  只给 Edge Function：在这一对好友的聊天记录里搜关键词

-- ============================================================
-- messages.author
-- ============================================================

alter table public.messages add column if not exists author text;

alter table public.messages drop constraint if exists messages_author_valid;
alter table public.messages add constraint messages_author_valid
  check (author is null or author in ('durian'));

-- 真人消息最多 2000 字；榴莲的回复最多 4000 字
alter table public.messages drop constraint if exists messages_body_valid;
alter table public.messages add constraint messages_body_valid
  check (
    body = btrim(body, E' \t\r\n')
    and char_length(body) >= 1
    and char_length(body) <= case when author is null then 2000 else 4000 end
  );

-- 兜底：就算以后有人给 authenticated 开了写权限，也不能写或改 author
-- （send_message 本来就不写 author；Edge Function 用平台管理员角色，不受影响）
create or replace function public.messages_author_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' and new.author is not null then
      raise exception 'author_forbidden';
    end if;
    if tg_op = 'UPDATE' and new.author is distinct from old.author then
      raise exception 'author_forbidden';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_author_guard on public.messages;
create trigger messages_author_guard
  before insert or update on public.messages
  for each row execute function public.messages_author_guard();

-- 注意：不改 list_conversations()。迁移会被整套重跑两遍，旧迁移里的 create or replace 版本返回列更少，
-- 这里再改返回列会让第二遍失败。会话列表的「最后一条是不是榴莲」由前端另查（messages.id in (...) and author is not null）。

-- ============================================================
-- 表
-- ============================================================

create table if not exists public.agent_jobs (
  id          bigint generated always as identity primary key,
  asker       uuid        not null references public.profiles (id) on delete cascade,
  peer        uuid        not null references public.profiles (id) on delete cascade,
  message_id  bigint      not null unique references public.messages (id) on delete cascade,
  status      text        not null default 'pending'
              constraint agent_jobs_status_valid check (status in ('pending', 'running', 'done', 'failed')),
  error       text        constraint agent_jobs_error_len check (error is null or char_length(error) <= 60),
  reply_id    bigint      references public.messages (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint agent_jobs_distinct check (asker <> peer)
);

-- 同一对好友同一时间只有一个进行中的任务（不分谁问的）
create unique index if not exists agent_jobs_one_active
  on public.agent_jobs (least(asker, peer), greatest(asker, peer))
  where status in ('pending', 'running');
create index if not exists agent_jobs_asker_idx on public.agent_jobs (asker, created_at desc);
create index if not exists agent_jobs_peer_idx on public.agent_jobs (peer, id desc);

-- 长期记忆：一对好友共用一份；user_lo < user_hi 保证一对好友只有一种写法
create table if not exists public.agent_memories (
  id          bigint generated always as identity primary key,
  user_lo     uuid        not null references public.profiles (id) on delete cascade,
  user_hi     uuid        not null references public.profiles (id) on delete cascade,
  content     text        not null
              constraint agent_memories_content_len check (char_length(content) between 1 and 300),
  created_at  timestamptz not null default now(),
  constraint agent_memories_ordered check (user_lo < user_hi)
);

create index if not exists agent_memories_pair_idx on public.agent_memories (user_lo, user_hi, id);

-- 每对好友最多 200 条记忆
create or replace function public.agent_memories_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.agent_memories m where m.user_lo = new.user_lo and m.user_hi = new.user_hi) >= 200 then
    raise exception 'memory_full';
  end if;
  return new;
end;
$$;

drop trigger if exists agent_memories_cap on public.agent_memories;
create trigger agent_memories_cap
  before insert on public.agent_memories
  for each row execute function public.agent_memories_cap();

-- ============================================================
-- 权限和 RLS：用户只能读自己参与的；写入只有 Edge Function（平台管理员角色）
-- ============================================================

revoke all on table public.agent_jobs, public.agent_memories from public, anon, authenticated;
grant select on table public.agent_jobs, public.agent_memories to authenticated;

alter table public.agent_jobs     enable row level security;
alter table public.agent_memories enable row level security;

drop policy if exists agent_jobs_select_pair on public.agent_jobs;
create policy agent_jobs_select_pair on public.agent_jobs
  for select to authenticated
  using (asker = (select auth.uid()) or peer = (select auth.uid()));

drop policy if exists agent_memories_select_pair on public.agent_memories;
create policy agent_memories_select_pair on public.agent_memories
  for select to authenticated
  using (user_lo = (select auth.uid()) or user_hi = (select auth.uid()));

-- 角色名拼接生成，本地 CI 的裸 Postgres 里没有这个角色时跳过
do $$
declare
  v_role text := 'service' || '_role';
begin
  if exists (select 1 from pg_roles where rolname = v_role) then
    execute format('grant select, insert, update, delete on table public.agent_jobs, public.agent_memories to %I', v_role);
    execute format('grant select, insert on table public.messages to %I', v_role);
  end if;
end $$;

-- ============================================================
-- RPC
-- ============================================================

-- 提问：p_message 是调用者自己刚发出的、带 @榴莲 的那条消息。返回新建的任务，随后前端再调用 agent-chat 函数开工
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
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_msg from public.messages m where m.id = p_message;
  if not found or v_msg.sender_id <> v_me or v_msg.author is not null then
    raise exception 'agent_forbidden';
  end if;
  if position('@榴莲' in v_msg.body) = 0 then
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

  insert into public.agent_jobs (asker, peer, message_id)
  values (v_me, v_msg.receiver_id, p_message)
  returning * into v_job;
  return v_job;
end;
$$;

revoke execute on function public.agent_ask(bigint) from public, anon;
grant execute on function public.agent_ask(bigint) to authenticated;

-- 在一对好友的聊天记录里按关键词搜（只给 Edge Function 用；ILIKE，走每对好友已有的会话索引，这个规模够用）
-- 每条只返回前 300 字，最多 20 条，新的在前；榴莲自己的回复也会搜到（带 author）
create or replace function public.agent_search_messages(p_a uuid, p_b uuid, p_query text, p_limit integer default 8)
returns table (id bigint, sender_id uuid, author text, body text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.sender_id, m.author, left(m.body, 300), m.created_at
  from public.messages m
  where ((m.sender_id = p_a and m.receiver_id = p_b) or (m.sender_id = p_b and m.receiver_id = p_a))
    and m.body ilike '%' || replace(replace(replace(left(coalesce(p_query, ''), 100), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
    and btrim(coalesce(p_query, '')) <> ''
  order by m.id desc
  limit greatest(1, least(coalesce(p_limit, 8), 20));
$$;

revoke execute on function public.agent_search_messages(uuid, uuid, text, integer) from public, anon, authenticated;

-- ============================================================
-- Realtime：任务状态变化实时推给双方（回复本身走 messages）
-- ============================================================

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'agent_jobs'
    ) then
      alter publication supabase_realtime add table public.agent_jobs;
    end if;
  else
    raise notice 'publication supabase_realtime 不存在，跳过 Realtime 配置';
  end if;
end $$;
