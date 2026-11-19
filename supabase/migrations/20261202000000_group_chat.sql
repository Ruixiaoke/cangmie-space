-- 群聊：groups / group_members、群消息（messages.group_id）、系统消息、群里的 AI 助手
-- 由 GitHub Actions 自动执行；可重复运行（整套迁移会跑两遍）
--
-- 设计：
--   groups            群（名字、群主、打开了哪些助手）。写入只走下面的 security definer 函数
--   group_members     成员；last_read_id 是这个成员已读到的最后一条群消息（群里没有逐条已读）
--   messages          多了 group_id；群消息 receiver_id 为空，且 receiver_id / group_id 恰好有一个
--                     author = 'system' 是系统提示行（「A 邀请 B 加入了群聊」），sender_id 是做这件事的人
--   agent_jobs        多了 group_id（peer 可为空）；agent_ask_group 建任务
--   agent_group_memories  助手对这个群的长期记忆（只有 Edge Function 能读写）
-- 注意：不改任何旧函数的返回列（list_conversations 等），群的列表用新函数 list_groups。

-- ============================================================
-- 表
-- ============================================================

create table if not exists public.groups (
  id          bigint generated always as identity primary key,
  name        text        not null
              constraint groups_name_length check (char_length(name) between 1 and 20),
  owner_id    uuid        not null references public.profiles (id) on delete cascade,
  agents      text[]      not null default '{}'
              constraint groups_agents_valid check (agents <@ array['durian', 'ye_ying']::text[]),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id      bigint      not null references public.groups (id) on delete cascade,
  user_id       uuid        not null references public.profiles (id) on delete cascade,
  joined_at     timestamptz not null default now(),
  last_read_id  bigint      not null default 0,
  primary key (group_id, user_id)
);
create index if not exists group_members_user_idx on public.group_members (user_id);

-- messages：群消息
alter table public.messages add column if not exists group_id bigint references public.groups (id) on delete cascade;
alter table public.messages alter column receiver_id drop not null;
alter table public.messages drop constraint if exists messages_target_one;
alter table public.messages add constraint messages_target_one check ((receiver_id is null) <> (group_id is null));
create index if not exists messages_group_idx on public.messages (group_id, id desc) where group_id is not null;

alter table public.messages drop constraint if exists messages_author_valid;
alter table public.messages add constraint messages_author_valid
  check (author is null or author in ('durian', 'ye_ying', 'system'));

-- ============================================================
-- 权限
-- ============================================================

revoke all on table public.groups, public.group_members from public, anon, authenticated;
grant select on table public.groups, public.group_members to authenticated;
alter table public.groups        enable row level security;
alter table public.group_members enable row level security;

-- 辅助函数：RLS 策略里直接查 group_members 会自己引用自己（无限递归），所以用 security definer 的函数绕过
create or replace function public.my_group_ids()
returns setof bigint
language sql
stable
security definer
set search_path = ''
as $$
  select gm.group_id from public.group_members gm where gm.user_id = auth.uid();
$$;

-- 和我同在某个群里的人（含我自己），用来让群成员互相看到昵称和头像
create or replace function public.my_group_peer_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select distinct b.user_id
  from public.group_members a
  join public.group_members b on b.group_id = a.group_id
  where a.user_id = auth.uid();
$$;

revoke execute on function public.my_group_ids(), public.my_group_peer_ids() from public, anon;
grant execute on function public.my_group_ids(), public.my_group_peer_ids() to authenticated;

drop policy if exists groups_select_member on public.groups;
create policy groups_select_member on public.groups
  for select to authenticated
  using (id in (select public.my_group_ids()));

drop policy if exists group_members_select_same_group on public.group_members;
create policy group_members_select_same_group on public.group_members
  for select to authenticated
  using (group_id in (select public.my_group_ids()));

-- 资料：自己、有好友记录的人，以及同群的人
drop policy if exists profiles_select_self_or_related on public.profiles;
create policy profiles_select_self_or_related on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.friendships f
      where (f.requester_id = (select auth.uid()) and f.addressee_id = profiles.id)
         or (f.addressee_id = (select auth.uid()) and f.requester_id = profiles.id)
    )
    or id in (select public.my_group_peer_ids())
  );

-- 消息：私聊照旧只有收发双方能看；群消息只有现在还在群里的成员能看（被移出 / 退群后看不到了）
drop policy if exists messages_select_own on public.messages;
create policy messages_select_own on public.messages
  for select to authenticated
  using (
    (group_id is null and (sender_id = (select auth.uid()) or receiver_id = (select auth.uid())))
    or (group_id is not null and group_id in (select public.my_group_ids()))
  );

-- ============================================================
-- 内部工具：写系统消息、取昵称
-- ============================================================

create or replace function public.group_system_line(p_group bigint, p_actor uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.messages (sender_id, group_id, body, author)
  values (p_actor, p_group, left(p_body, 200), 'system');
  update public.groups g set updated_at = now() where g.id = p_group;
end;
$$;
revoke execute on function public.group_system_line(bigint, uuid, text) from public, anon, authenticated;

create or replace function public.group_nick(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select p.nickname from public.profiles p where p.id = p_user), '好友');
$$;
revoke execute on function public.group_nick(uuid) from public, anon, authenticated;

create or replace function public.group_agent_name(p_agent text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_agent when 'ye_ying' then '叶英' else '沈剑心' end;
$$;
revoke execute on function public.group_agent_name(text) from public, anon, authenticated;

-- 两个人是不是已接受的好友
create or replace function public.group_is_friend(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and least(f.requester_id, f.addressee_id) = least(p_a, p_b)
      and greatest(f.requester_id, f.addressee_id) = greatest(p_a, p_b)
  );
$$;
revoke execute on function public.group_is_friend(uuid, uuid) from public, anon, authenticated;

-- ============================================================
-- RPC
-- ============================================================

-- 建群：成员必须都是我已接受的好友；名字为空就用前几个成员的昵称（最多 20 字）
create or replace function public.create_group(p_name text, p_members uuid[])
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := auth.uid();
  v_members uuid[];
  v_name    text := btrim(coalesce(p_name, ''), E' \t\r\n');
  v_u       uuid;
  v_nicks   text[];
  v_group   public.groups;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_members
    from unnest(coalesce(p_members, '{}')) as x where x is not null and x <> v_me;
  if coalesce(array_length(v_members, 1), 0) < 1 then
    raise exception 'invalid_members';
  end if;
  if array_length(v_members, 1) > 49 then
    raise exception 'group_full';
  end if;
  foreach v_u in array v_members loop
    if not public.group_is_friend(v_me, v_u) then
      raise exception 'not_friends';
    end if;
  end loop;

  if v_name = '' then
    select array_agg(p.nickname order by array_position(v_members, p.id)) into v_nicks
      from public.profiles p where p.id = any(v_members);
    v_name := left(array_to_string(v_nicks[1:3], '、'), 20);
  end if;
  if char_length(v_name) not between 1 and 20 then
    raise exception 'invalid_group_name';
  end if;

  insert into public.groups (name, owner_id) values (v_name, v_me) returning * into v_group;
  insert into public.group_members (group_id, user_id) values (v_group.id, v_me);
  insert into public.group_members (group_id, user_id) select v_group.id, x from unnest(v_members) as x;
  perform public.group_system_line(v_group.id, v_me, public.group_nick(v_me) || ' 创建了群聊');
  return v_group;
end;
$$;

-- 拉人进群：群里任何人都可以拉自己的好友；已经在群里的跳过；返回新加了几个
create or replace function public.add_group_members(p_group bigint, p_members uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_new   uuid[];
  v_u     uuid;
  v_n     integer;
  v_nicks text;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  perform 1 from public.groups g where g.id = p_group for update;
  if not found or not exists (select 1 from public.group_members gm where gm.group_id = p_group and gm.user_id = v_me) then
    raise exception 'not_group_member';
  end if;

  select coalesce(array_agg(distinct x), '{}') into v_new
    from unnest(coalesce(p_members, '{}')) as x
   where x is not null and x <> v_me
     and not exists (select 1 from public.group_members gm where gm.group_id = p_group and gm.user_id = x);
  v_n := coalesce(array_length(v_new, 1), 0);
  if v_n = 0 then
    raise exception 'invalid_members';
  end if;
  foreach v_u in array v_new loop
    if not public.group_is_friend(v_me, v_u) then
      raise exception 'not_friends';
    end if;
  end loop;
  if (select count(*) from public.group_members gm where gm.group_id = p_group) + v_n > 50 then
    raise exception 'group_full';
  end if;

  insert into public.group_members (group_id, user_id)
  select p_group, x from unnest(v_new) as x;
  select string_agg(p.nickname, '、' order by array_position(v_new, p.id)) into v_nicks
    from public.profiles p where p.id = any(v_new);
  perform public.group_system_line(p_group, v_me, public.group_nick(v_me) || ' 邀请 ' || v_nicks || ' 加入了群聊');
  return v_n;
end;
$$;

-- 群主移出成员
create or replace function public.remove_group_member(p_group bigint, p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_g  public.groups;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into v_g from public.groups g where g.id = p_group for update;
  if not found or not exists (select 1 from public.group_members gm where gm.group_id = p_group and gm.user_id = v_me) then
    raise exception 'not_group_member';
  end if;
  if v_g.owner_id <> v_me then
    raise exception 'not_group_owner';
  end if;
  if p_user is null or p_user = v_me then
    raise exception 'invalid_argument';
  end if;
  if not exists (select 1 from public.group_members gm where gm.group_id = p_group and gm.user_id = p_user) then
    raise exception 'not_group_member';
  end if;

  perform public.group_system_line(p_group, v_me, public.group_nick(v_me) || ' 把 ' || public.group_nick(p_user) || ' 移出了群聊');
  delete from public.group_members gm where gm.group_id = p_group and gm.user_id = p_user;
end;
$$;

-- 退群：群主退群时转给最早加入的剩下的人；最后一个人退群就删掉整个群。返回群是不是被删了
create or replace function public.leave_group(p_group bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := auth.uid();
  v_g    public.groups;
  v_next uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into v_g from public.groups g where g.id = p_group for update;
  if not found or not exists (select 1 from public.group_members gm where gm.group_id = p_group and gm.user_id = v_me) then
    raise exception 'not_group_member';
  end if;

  select gm.user_id into v_next
    from public.group_members gm
   where gm.group_id = p_group and gm.user_id <> v_me
   order by gm.joined_at, gm.user_id
   limit 1;
  if v_next is null then
    delete from public.groups g where g.id = p_group; -- 成员和消息跟着级联删除
    return true;
  end if;

  perform public.group_system_line(p_group, v_me, public.group_nick(v_me) || ' 退出了群聊');
  delete from public.group_members gm where gm.group_id = p_group and gm.user_id = v_me;
  if v_g.owner_id = v_me then
    update public.groups g set owner_id = v_next where g.id = p_group;
  end if;
  return false;
end;
$$;

-- 改群名：群里任何人都可以
create or replace function public.rename_group(p_group bigint, p_name text)
returns public.groups
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''), E' \t\r\n');
  v_g    public.groups;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  perform 1 from public.groups g where g.id = p_group for update;
  if not found or not exists (select 1 from public.group_members gm where gm.group_id = p_group and gm.user_id = v_me) then
    raise exception 'not_group_member';
  end if;
  if char_length(v_name) not between 1 and 20 then
    raise exception 'invalid_group_name';
  end if;

  update public.groups g set name = v_name, updated_at = now() where g.id = p_group returning * into v_g;
  perform public.group_system_line(p_group, v_me, public.group_nick(v_me) || ' 把群名改成 ' || v_name);
  return v_g;
end;
$$;

-- 设置群里打开哪些助手（完整列表）；每个变化写一行系统消息
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
  if not (v_new <@ array['durian', 'ye_ying']::text[]) then
    raise exception 'invalid_argument';
  end if;

  update public.groups g set agents = v_new, updated_at = now() where g.id = p_group returning * into v_g;
  foreach v_a in array array['durian', 'ye_ying'] loop
    if v_a = any(v_new) and not (v_a = any(v_old)) then
      perform public.group_system_line(p_group, v_me, public.group_nick(v_me) || ' 打开了' || public.group_agent_name(v_a));
    elsif v_a = any(v_old) and not (v_a = any(v_new)) then
      perform public.group_system_line(p_group, v_me, public.group_nick(v_me) || ' 关掉了' || public.group_agent_name(v_a));
    end if;
  end loop;
  return v_g;
end;
$$;

-- 发群消息；引用的消息必须在同一个群里
create or replace function public.send_group_message(p_group bigint, p_body text, p_reply_to bigint default null)
returns public.messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''), E' \t\r\n');
  v_msg  public.messages;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if v_body = '' then
    raise exception 'empty_message';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'message_too_long';
  end if;
  if p_group is null or not exists (select 1 from public.group_members gm where gm.group_id = p_group and gm.user_id = v_me) then
    raise exception 'not_group_member';
  end if;
  if p_reply_to is not null and not exists (
    select 1 from public.messages q where q.id = p_reply_to and q.group_id = p_group
  ) then
    raise exception 'invalid_reply';
  end if;

  insert into public.messages (sender_id, group_id, body, reply_to)
  values (v_me, p_group, v_body, p_reply_to)
  returning * into v_msg;
  update public.group_members gm set last_read_id = greatest(gm.last_read_id, v_msg.id)
   where gm.group_id = p_group and gm.user_id = v_me; -- 自己发的消息不算自己的未读
  update public.groups g set updated_at = now() where g.id = p_group;
  return v_msg;
end;
$$;

-- 把这个群标成已读（到现在为止的最后一条）；返回已读到的消息 id
create or replace function public.mark_group_read(p_group bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me  uuid := auth.uid();
  v_max bigint;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select coalesce(max(m.id), 0) into v_max from public.messages m where m.group_id = p_group;
  update public.group_members gm set last_read_id = greatest(gm.last_read_id, v_max)
   where gm.group_id = p_group and gm.user_id = v_me
  returning gm.last_read_id into v_max;
  if not found then
    raise exception 'not_group_member';
  end if;
  return v_max;
end;
$$;

-- 我的群列表：每个群一行，带成员 id（按加入先后）、最后一条消息和未读数
-- 未读 = 别人发的真人消息 + 助手的回复；系统消息和自己发的不算
create or replace function public.list_groups()
returns table (
  id bigint, name text, owner_id uuid, agents text[], member_ids uuid[], created_at timestamptz, updated_at timestamptz,
  last_id bigint, last_body text, last_sender_id uuid, last_author text, last_at timestamptz,
  last_read_id bigint, unread_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  return query
  select g.id, g.name, g.owner_id, g.agents,
         (select array_agg(x.user_id order by x.joined_at, x.user_id) from public.group_members x where x.group_id = g.id),
         g.created_at, g.updated_at,
         m.id, m.body, m.sender_id, m.author, m.created_at,
         me.last_read_id,
         (select count(*) from public.messages u
           where u.group_id = g.id and u.id > me.last_read_id
             and coalesce(u.author, '') <> 'system'
             and (u.author is not null or u.sender_id <> v_me))
  from public.group_members me
  join public.groups g on g.id = me.group_id
  left join lateral (
    select x.id, x.body, x.sender_id, x.author, x.created_at
    from public.messages x where x.group_id = g.id order by x.id desc limit 1
  ) m on true
  where me.user_id = v_me
  order by coalesce(m.created_at, g.created_at) desc;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'create_group(text, uuid[])', 'add_group_members(bigint, uuid[])', 'remove_group_member(bigint, uuid)',
    'leave_group(bigint)', 'rename_group(bigint, text)', 'set_group_agents(bigint, text[])',
    'send_group_message(bigint, text, bigint)', 'mark_group_read(bigint)', 'list_groups()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ============================================================
-- 助手在群里
-- ============================================================

alter table public.agent_jobs add column if not exists group_id bigint references public.groups (id) on delete cascade;
alter table public.agent_jobs alter column peer drop not null;
alter table public.agent_jobs drop constraint if exists agent_jobs_target_one;
alter table public.agent_jobs add constraint agent_jobs_target_one check ((peer is null) <> (group_id is null));

-- 私聊：同一对好友、同一个助手同时只有一个进行中的任务（只管私聊任务：peer 为空时 least(asker, null) 会返回 asker，所以要加条件）
drop index if exists public.agent_jobs_one_active;
create unique index agent_jobs_one_active
  on public.agent_jobs (least(asker, peer), greatest(asker, peer), agent_id)
  where status in ('pending', 'running') and group_id is null;
-- 群里：同一个群、同一个助手同时只有一个进行中的任务
drop index if exists public.agent_jobs_one_active_group;
create unique index agent_jobs_one_active_group
  on public.agent_jobs (group_id, agent_id)
  where status in ('pending', 'running') and group_id is not null;
create index if not exists agent_jobs_group_idx on public.agent_jobs (group_id, id desc) where group_id is not null;

-- 任务：提问的人或对方能看；群任务整个群的成员都能看（别人也看到「思考中」）
drop policy if exists agent_jobs_select_pair on public.agent_jobs;
create policy agent_jobs_select_pair on public.agent_jobs
  for select to authenticated
  using (
    (group_id is null and (asker = (select auth.uid()) or peer = (select auth.uid())))
    or (group_id is not null and group_id in (select public.my_group_ids()))
  );

-- 群记忆：每个（群, 助手）一份；规则和 agent_memories 一样（标题 1 到 20 字、内容 500 字、最多 200 条、常驻最多 10 条）
create table if not exists public.agent_group_memories (
  id          bigint generated always as identity primary key,
  group_id    bigint      not null references public.groups (id) on delete cascade,
  agent_id    text        not null check (agent_id in ('durian', 'ye_ying')),
  title       text        not null
              constraint agent_group_memories_title_valid check (title = btrim(title, E' \t\r\n') and char_length(title) between 1 and 20),
  content     text        not null
              constraint agent_group_memories_content_len check (char_length(content) between 1 and 500),
  pinned      boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists agent_group_memories_title_uq on public.agent_group_memories (group_id, agent_id, title);

create or replace function public.agent_group_memories_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and not exists (
       select 1 from public.agent_group_memories m where m.group_id = new.group_id and m.agent_id = new.agent_id and m.title = new.title)
     and (select count(*) from public.agent_group_memories m where m.group_id = new.group_id and m.agent_id = new.agent_id) >= 200 then
    raise exception 'memory_full';
  end if;
  if new.pinned and (select count(*) from public.agent_group_memories m
                      where m.group_id = new.group_id and m.agent_id = new.agent_id and m.pinned and m.title <> new.title) >= 10 then
    raise exception 'pinned_full';
  end if;
  return new;
end;
$$;

drop trigger if exists agent_group_memories_cap on public.agent_group_memories;
create trigger agent_group_memories_cap
  before insert or update on public.agent_group_memories
  for each row execute function public.agent_group_memories_cap();

create or replace function public.agent_group_memories_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists agent_group_memories_touch on public.agent_group_memories;
create trigger agent_group_memories_touch
  before update on public.agent_group_memories
  for each row execute function public.agent_group_memories_touch();

-- 用户不能直接读写群记忆（和私聊记忆不同：群里没有「一对好友」可以授权），只有 Edge Function（平台管理员角色）
revoke all on table public.agent_group_memories from public, anon, authenticated;
alter table public.agent_group_memories enable row level security;

-- 群里提问：p_message 是我自己刚发的、带 @助手 的群消息；这个助手必须已经在群里打开
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
  if p_agent_id is null
     or not ((p_agent_id = 'durian' and v_msg.body ~ '[@＠](沈剑心|榴莲)')
          or (p_agent_id = 'ye_ying' and v_msg.body ~ '[@＠]叶英')) then
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

-- 在群聊天记录里按关键词搜（只给 Edge Function 用）；不含系统消息，只搜 p_before 之前的
create or replace function public.agent_search_group_messages(p_group bigint, p_query text, p_limit integer, p_before bigint)
returns table (id bigint, sender_id uuid, author text, body text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select m.id, m.sender_id, m.author, left(m.body, 300), m.created_at
  from public.messages m
  where m.group_id = p_group
    and coalesce(m.author, '') <> 'system'
    and m.id < p_before
    and m.body ilike '%' || replace(replace(replace(left(coalesce(p_query, ''), 100), '\', '\\'), '%', '\%'), '_', '\_') || '%' escape '\'
    and btrim(coalesce(p_query, '')) <> ''
  order by m.id desc
  limit greatest(1, least(coalesce(p_limit, 5), 10));
$$;

revoke execute on function public.agent_search_group_messages(bigint, text, integer, bigint) from public, anon, authenticated;

do $$
declare
  v_role text := 'service' || '_role';
begin
  if exists (select 1 from pg_roles where rolname = v_role) then
    execute format('grant select, insert, update, delete on table public.agent_group_memories to %I', v_role);
    execute format('grant select on table public.groups, public.group_members to %I', v_role);
    execute format('grant execute on function public.agent_search_group_messages(bigint, text, integer, bigint) to %I', v_role);
  end if;
end $$;

-- ============================================================
-- Realtime
-- ============================================================

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['groups', 'group_members'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  else
    raise notice 'publication supabase_realtime 不存在，跳过 Realtime 配置';
  end if;
end $$;

-- 成员被移出时的 DELETE 事件带上完整旧行（Realtime 默认只带主键）
alter table public.group_members replica identity full;
