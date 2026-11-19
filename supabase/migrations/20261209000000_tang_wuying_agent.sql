-- 新 agent：唐无影（tang_wuying）。只需在集中名单的三个函数里各加一行（见 .claude/skills/chat-agent/SKILL.md）。
-- 由 GitHub Actions 自动执行；可重复运行

create or replace function public.agent_ids()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['durian', 'ye_ying', 'xie_yunliu', 'li_wangsheng', 'tang_wuying']::text[];
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
    when 'tang_wuying'  then p_body ~ '[@＠]唐无影'
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
    when 'tang_wuying'  then '唐无影'
    else '沈剑心'
  end;
$$;

revoke execute on function public.group_agent_name(text) from public, anon, authenticated;
