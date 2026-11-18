-- 榴莲的长期记忆改成「带标题的条目」，并收紧搜索片段（省 token）
-- 由 GitHub Actions（.github/workflows/backend.yml）自动执行；可重复运行
--
-- agent_memories：每条有标题（同一对好友内唯一）、内容（最多 500 字）、pinned（常驻）、updated_at
--   旧数据：没有标题的老记忆自动命名为「未分类·<编号>」，内容原样保留
--   pinned 每对好友最多 10 条，超过会报错 pinned_full（由榴莲在工具里收到，自己决定取消哪条）
--   总条数上限仍是 200；用标题更新已有条目不算新增
-- 写入仍然只有 Edge Function（平台管理员角色）；双方只读（RLS 不变）

alter table public.agent_memories add column if not exists title text;
alter table public.agent_memories add column if not exists pinned boolean not null default false;
alter table public.agent_memories add column if not exists updated_at timestamptz not null default now();

-- 旧数据补标题（第二次运行时没有 null，什么也不做）
update public.agent_memories set title = '未分类·' || id where title is null;
alter table public.agent_memories alter column title set not null;

alter table public.agent_memories drop constraint if exists agent_memories_title_valid;
alter table public.agent_memories add constraint agent_memories_title_valid
  check (title = btrim(title, E' \t\r\n') and char_length(title) between 1 and 20);

alter table public.agent_memories drop constraint if exists agent_memories_content_len;
alter table public.agent_memories add constraint agent_memories_content_len
  check (char_length(content) between 1 and 500);

create unique index if not exists agent_memories_pair_title_uq
  on public.agent_memories (user_lo, user_hi, title);

-- 上限：200 条（同标题的 upsert 是更新，不算新增）；pinned 最多 10 条
create or replace function public.agent_memories_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and not exists (
       select 1 from public.agent_memories m where m.user_lo = new.user_lo and m.user_hi = new.user_hi and m.title = new.title)
     and (select count(*) from public.agent_memories m where m.user_lo = new.user_lo and m.user_hi = new.user_hi) >= 200 then
    raise exception 'memory_full';
  end if;
  if new.pinned and (select count(*) from public.agent_memories m
                      where m.user_lo = new.user_lo and m.user_hi = new.user_hi and m.pinned and m.title <> new.title) >= 10 then
    raise exception 'pinned_full';
  end if;
  return new;
end;
$$;

drop trigger if exists agent_memories_cap on public.agent_memories;
create trigger agent_memories_cap
  before insert or update on public.agent_memories
  for each row execute function public.agent_memories_cap();

-- 内容或标题有变化时刷新 updated_at（索引里的「更新日期」靠它）
create or replace function public.agent_memories_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists agent_memories_touch on public.agent_memories;
create trigger agent_memories_touch
  before update on public.agent_memories
  for each row execute function public.agent_memories_touch();

-- 搜聊天记录：片段 160 字（原来 300），默认 5 条，最多 10 条（原来 8 / 20）；授权不变
create or replace function public.agent_search_messages(p_a uuid, p_b uuid, p_query text, p_limit integer default 5)
returns table (id bigint, sender_id uuid, author text, body text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.sender_id, m.author, left(m.body, 160), m.created_at
  from public.messages m
  where ((m.sender_id = p_a and m.receiver_id = p_b) or (m.sender_id = p_b and m.receiver_id = p_a))
    and m.body ilike '%' || replace(replace(replace(left(coalesce(p_query, ''), 100), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
    and btrim(coalesce(p_query, '')) <> ''
  order by m.id desc
  limit greatest(1, least(coalesce(p_limit, 5), 10));
$$;

revoke execute on function public.agent_search_messages(uuid, uuid, text, integer) from public, anon, authenticated;
