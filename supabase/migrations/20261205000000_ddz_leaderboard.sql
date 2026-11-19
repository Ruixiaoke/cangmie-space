-- 斗地主排行榜：按积分排名（ddz_leaderboard），由 GitHub Actions 自动执行；可重复运行
--
-- ddz_leaderboard(p_group)  只读，不新增表：直接从 ddz_scores 算
--   p_group 为空：好友榜。范围 = 我 + 我所有已接受的好友，每个人把自己在所有桌子（所有群的行和所有私聊对的行）上的 total / wins / games 加起来
--   p_group 有值：本群榜。范围 = 这个群的成员，只算这个群自己的行（group_id = p_group）；调用者必须是群成员，否则 not_group_member
-- 只有真人有 ddz_scores 行。一局都没打过的人不出现，只有我自己例外（没打过也显示，0 分），和另外四张榜一致。
-- 积分可以是负数。排序：积分多、胜场多、局数少、昵称。
-- 不改 game_leaderboard 的签名和返回类型。

create or replace function public.ddz_leaderboard(p_group bigint default null)
returns table (user_id uuid, nickname text, avatar_path text, total bigint, wins bigint, games bigint)
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

  if p_group is not null then
    if not exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = v_me) then
      raise exception 'not_group_member';
    end if;
    return query
    with tot as (
      select s.user_id as uid, sum(s.total) as t, sum(s.wins) as w, sum(s.games) as g
      from public.ddz_scores s
      where s.group_id = p_group
        and s.user_id in (select m.user_id from public.group_members m where m.group_id = p_group)
      group by s.user_id
    )
    select p.id, p.nickname, p.avatar_path, coalesce(t.t, 0)::bigint, coalesce(t.w, 0)::bigint, coalesce(t.g, 0)::bigint
    from public.profiles p
    left join tot t on t.uid = p.id
    where p.id = v_me or t.g > 0
    order by coalesce(t.t, 0) desc, coalesce(t.w, 0) desc, coalesce(t.g, 0) asc, p.nickname asc, p.id asc;
    return;
  end if;

  return query
  with ppl as (
    select v_me as uid
    union
    select case when f.requester_id = v_me then f.addressee_id else f.requester_id end
    from public.friendships f
    where f.status = 'accepted' and v_me in (f.requester_id, f.addressee_id)
  ),
  tot as (
    select s.user_id as uid, sum(s.total) as t, sum(s.wins) as w, sum(s.games) as g
    from public.ddz_scores s
    where s.user_id in (select uid from ppl)
    group by s.user_id
  )
  select p.id, p.nickname, p.avatar_path, coalesce(t.t, 0)::bigint, coalesce(t.w, 0)::bigint, coalesce(t.g, 0)::bigint
  from ppl
  join public.profiles p on p.id = ppl.uid
  left join tot t on t.uid = ppl.uid
  where ppl.uid = v_me or t.g > 0
  order by coalesce(t.t, 0) desc, coalesce(t.w, 0) desc, coalesce(t.g, 0) asc, p.nickname asc, p.id asc;
end;
$$;

revoke execute on function public.ddz_leaderboard(bigint) from public, anon;
grant execute on function public.ddz_leaderboard(bigint) to authenticated;
