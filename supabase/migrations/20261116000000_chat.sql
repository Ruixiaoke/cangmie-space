-- 聊天小程序：用户资料、好友关系、私聊消息、头像存储
-- 由 GitHub Actions（.github/workflows/backend.yml）自动执行；可重复运行
--
-- 前端只持有 anon key，登录后使用 authenticated 角色。
-- 三张表只开放 SELECT（受 RLS 限制），所有写入都走下面的 security definer 函数。

-- ============================================================
-- 表
-- ============================================================

-- 用户资料：username 由注册邮箱的本地部分生成（见 handle_new_user），之后不可修改
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text        not null unique
               constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,20}$'),
  nickname     text        not null
               constraint profiles_nickname_length check (char_length(nickname) between 1 and 20),
  -- 存储桶里的对象路径（不是 URL），必须在自己的目录 <uid>/ 下；前端自己拼公开地址
  avatar_path  text
               constraint profiles_avatar_own_folder check (avatar_path is null or avatar_path like id::text || '/%'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 好友关系：每对用户只有一行（不分谁先发起）
create table if not exists public.friendships (
  id            bigint generated always as identity primary key,
  requester_id  uuid        not null references public.profiles (id) on delete cascade,
  addressee_id  uuid        not null references public.profiles (id) on delete cascade,
  status        text        not null default 'pending'
                constraint friendships_status_valid check (status in ('pending', 'accepted', 'declined')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint friendships_not_self check (requester_id <> addressee_id)
);

create unique index if not exists friendships_pair_key
  on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists friendships_requester_idx on public.friendships (requester_id);
create index if not exists friendships_addressee_idx on public.friendships (addressee_id);

-- 私聊消息：只存文字，read_at 为空表示未读
create table if not exists public.messages (
  id           bigint generated always as identity primary key,
  sender_id    uuid        not null references public.profiles (id) on delete cascade,
  receiver_id  uuid        not null references public.profiles (id) on delete cascade,
  body         text        not null
               constraint messages_body_valid check (
                 body = btrim(body, E' \t\r\n') and char_length(body) between 1 and 2000
               ),
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  constraint messages_not_self check (sender_id <> receiver_id)
);

-- 按会话翻页：两个方向各一个索引
create index if not exists messages_sent_idx on public.messages (sender_id, receiver_id, id desc);
create index if not exists messages_received_idx on public.messages (receiver_id, sender_id, id desc);
-- 未读数
create index if not exists messages_unread_idx on public.messages (receiver_id, sender_id) where read_at is null;

-- ============================================================
-- 权限：显式授权，不依赖 Supabase 的默认权限
-- ============================================================

revoke all on table public.profiles, public.friendships, public.messages from public, anon, authenticated;
grant select on table public.profiles, public.friendships, public.messages to authenticated;

-- ============================================================
-- RLS：只有 SELECT policy，没有任何写入 policy
-- ============================================================

alter table public.profiles    enable row level security;
alter table public.friendships enable row level security;
alter table public.messages    enable row level security;

drop policy if exists friendships_select_own on public.friendships;
create policy friendships_select_own on public.friendships
  for select to authenticated
  using (requester_id = (select auth.uid()) or addressee_id = (select auth.uid()));

-- 自己的资料，以及和自己有任何好友记录（待处理、已接受、已拒绝）的人的资料
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
  );

drop policy if exists messages_select_own on public.messages;
create policy messages_select_own on public.messages
  for select to authenticated
  using (sender_id = (select auth.uid()) or receiver_id = (select auth.uid()));

-- ============================================================
-- 注册时自动建资料
-- ============================================================

-- username = 邮箱 @ 前面的部分（小写），保证"用户名 -> 邮箱"的登录映射；不合法的用户名会让注册失败
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text := lower(split_part(new.email, '@', 1));
  v_nickname text := left(nullif(btrim(coalesce(new.raw_user_meta_data ->> 'nickname', '')), ''), 20);
begin
  insert into public.profiles (id, username, nickname)
  values (new.id, v_username, coalesce(v_nickname, v_username));
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- RPC：错误信息是稳定的机器可读字符串，前端负责翻译成中文
-- ============================================================

-- 注册前检查用户名是否可用（唯一允许 anon 调用的函数）
create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(lower(btrim(p_username)) ~ '^[a-z0-9_]{3,20}$', false)
     and not exists (select 1 from public.profiles p where p.username = lower(btrim(p_username)));
$$;

revoke execute on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;

-- 按用户名精确查找，只返回最少的公开字段；relation 描述我和对方当前的关系
create or replace function public.find_user(p_username text)
returns table (user_id uuid, username text, nickname text, avatar_path text, relation text)
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
  select p.id, p.username, p.nickname, p.avatar_path,
    case
      when p.id = v_me then 'self'
      when f.id is null or f.status = 'declined' then 'none'
      when f.status = 'accepted' then 'friend'
      when f.requester_id = v_me then 'outgoing'
      else 'incoming'
    end
  from public.profiles p
  left join public.friendships f
    on least(f.requester_id, f.addressee_id) = least(v_me, p.id)
   and greatest(f.requester_id, f.addressee_id) = greatest(v_me, p.id)
  where p.username = lower(btrim(p_username));
end;
$$;

revoke execute on function public.find_user(text) from public, anon;
grant execute on function public.find_user(text) to authenticated;

-- 发好友请求；对方已经请求过我时直接互为好友。返回 'requested' 或 'accepted'
create or replace function public.send_friend_request(p_username text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_peer   uuid;
  v_row    public.friendships;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select p.id into v_peer from public.profiles p where p.username = lower(btrim(p_username));
  if v_peer is null then
    raise exception 'user_not_found';
  end if;
  if v_peer = v_me then
    raise exception 'cannot_add_self';
  end if;

  -- 同一对用户的并发请求排队处理
  perform pg_advisory_xact_lock(hashtextextended(least(v_me, v_peer)::text || greatest(v_me, v_peer)::text, 0));

  select * into v_row from public.friendships f
  where least(f.requester_id, f.addressee_id) = least(v_me, v_peer)
    and greatest(f.requester_id, f.addressee_id) = greatest(v_me, v_peer);

  if not found then
    insert into public.friendships (requester_id, addressee_id) values (v_me, v_peer);
    return 'requested';
  end if;

  if v_row.status = 'accepted' then
    raise exception 'already_friends';
  elsif v_row.status = 'pending' then
    if v_row.requester_id = v_me then
      raise exception 'request_already_sent';
    end if;
    -- 对方先请求了我：直接通过
    update public.friendships set status = 'accepted', updated_at = now() where id = v_row.id;
    return 'accepted';
  else
    -- 被拒绝过：允许重新发起（发起方变成我）
    update public.friendships
       set requester_id = v_me, addressee_id = v_peer, status = 'pending', updated_at = now()
     where id = v_row.id;
    return 'requested';
  end if;
end;
$$;

revoke execute on function public.send_friend_request(text) from public, anon;
grant execute on function public.send_friend_request(text) to authenticated;

-- 被请求的一方接受或拒绝；返回新的状态
create or replace function public.respond_friend_request(p_id bigint, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_status text := case when p_accept then 'accepted' else 'declined' end;
  v_id     bigint;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_accept is null then
    raise exception 'invalid_argument';
  end if;

  update public.friendships f
     set status = v_status, updated_at = now()
   where f.id = p_id and f.addressee_id = v_me and f.status = 'pending'
  returning f.id into v_id;

  if v_id is null then
    raise exception 'request_not_found';
  end if;
  return v_status;
end;
$$;

revoke execute on function public.respond_friend_request(bigint, boolean) from public, anon;
grant execute on function public.respond_friend_request(bigint, boolean) to authenticated;

-- 发消息：只能发给已接受的好友
create or replace function public.send_message(p_peer uuid, p_body text)
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

  if p_peer is null or p_peer = v_me or not exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and least(f.requester_id, f.addressee_id) = least(v_me, p_peer)
      and greatest(f.requester_id, f.addressee_id) = greatest(v_me, p_peer)
  ) then
    raise exception 'not_friends';
  end if;

  insert into public.messages (sender_id, receiver_id, body)
  values (v_me, p_peer, v_body)
  returning * into v_msg;
  return v_msg;
end;
$$;

revoke execute on function public.send_message(uuid, text) from public, anon;
grant execute on function public.send_message(uuid, text) to authenticated;

-- 把对方发给我的未读消息标为已读；返回标记的条数
create or replace function public.mark_read(p_peer uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_n  integer;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  update public.messages m
     set read_at = now()
   where m.receiver_id = v_me and m.sender_id = p_peer and m.read_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.mark_read(uuid) from public, anon;
grant execute on function public.mark_read(uuid) to authenticated;

-- 修改自己的昵称和头像路径；参数为 null 表示不修改
create or replace function public.update_profile(p_nickname text default null, p_avatar_path text default null)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me       uuid := auth.uid();
  v_nickname text := btrim(p_nickname);
  v_row      public.profiles;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if v_nickname is not null and char_length(v_nickname) not between 1 and 20 then
    raise exception 'invalid_nickname';
  end if;
  -- 头像只能放在自己的目录下，且不能带 .. 之类的路径花样
  if p_avatar_path is not null and (
       left(p_avatar_path, 37) <> v_me::text || '/'
       or char_length(p_avatar_path) > 200
       or p_avatar_path !~ '^[0-9a-f-]{36}/[A-Za-z0-9._-]+$'
     ) then
    raise exception 'invalid_avatar';
  end if;

  update public.profiles p
     set nickname    = coalesce(v_nickname, p.nickname),
         avatar_path = coalesce(p_avatar_path, p.avatar_path),
         updated_at  = now()
   where p.id = v_me
  returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function public.update_profile(text, text) from public, anon;
grant execute on function public.update_profile(text, text) to authenticated;

-- 会话列表：每个已接受的好友一行，带最后一条消息和未读数，最近的在前
create or replace function public.list_conversations()
returns table (
  peer_id uuid, peer_username text, peer_nickname text, peer_avatar_path text,
  last_id bigint, last_body text, last_sender_id uuid, last_at timestamptz, last_read_at timestamptz,
  unread_count bigint, friends_since timestamptz
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
  select p.id, p.username, p.nickname, p.avatar_path,
         m.id, m.body, m.sender_id, m.created_at, m.read_at,
         (select count(*) from public.messages u
           where u.receiver_id = v_me and u.sender_id = p.id and u.read_at is null),
         f.updated_at
  from public.friendships f
  join public.profiles p
    on p.id = case when f.requester_id = v_me then f.addressee_id else f.requester_id end
  left join lateral (
    select x.id, x.body, x.sender_id, x.created_at, x.read_at
    from public.messages x
    where (x.sender_id = v_me and x.receiver_id = p.id)
       or (x.sender_id = p.id and x.receiver_id = v_me)
    order by x.id desc
    limit 1
  ) m on true
  where f.status = 'accepted' and (f.requester_id = v_me or f.addressee_id = v_me)
  order by coalesce(m.created_at, f.updated_at) desc;
end;
$$;

revoke execute on function public.list_conversations() from public, anon;
grant execute on function public.list_conversations() to authenticated;

-- ============================================================
-- Realtime：消息和好友关系的变化会推送给有权限看到它们的人
-- ============================================================

do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['messages', 'friendships'] loop
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

-- ============================================================
-- 头像存储：公开读取的桶，只有本人能写自己 <uid>/ 目录下的文件
-- ============================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 524288, array['image/jpeg', 'image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists avatars_select_own on storage.objects;
create policy avatars_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists avatars_delete_own on storage.objects;
create policy avatars_delete_own on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
