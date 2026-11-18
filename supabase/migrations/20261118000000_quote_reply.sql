-- 聊天小程序：引用回复（微信的"引用"）
-- 由 GitHub Actions（.github/workflows/backend.yml）自动执行；可重复运行
--
-- messages 新增 reply_to，指向被引用的那条消息；被引用的消息删除后置空。
-- send_message 多一个可选参数 p_reply_to，旧客户端只传两个参数照常可用。

alter table public.messages
  add column if not exists reply_to bigint references public.messages (id) on delete set null;

create index if not exists messages_reply_to_idx on public.messages (reply_to) where reply_to is not null;

-- 先删旧的两参数版本：两个重载并存会让两参数调用有歧义
drop function if exists public.send_message(uuid, text);

-- 发消息：只能发给已接受的好友；引用的消息必须属于同一个会话（双方任一方向）
create or replace function public.send_message(p_peer uuid, p_body text, p_reply_to bigint default null)
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

  if p_reply_to is not null and not exists (
    select 1 from public.messages q
    where q.id = p_reply_to
      and ((q.sender_id = v_me and q.receiver_id = p_peer)
        or (q.sender_id = p_peer and q.receiver_id = v_me))
  ) then
    raise exception 'invalid_reply';
  end if;

  insert into public.messages (sender_id, receiver_id, body, reply_to)
  values (v_me, p_peer, v_body, p_reply_to)
  returning * into v_msg;
  return v_msg;
end;
$$;

revoke execute on function public.send_message(uuid, text, bigint) from public, anon;
grant execute on function public.send_message(uuid, text, bigint) to authenticated;
