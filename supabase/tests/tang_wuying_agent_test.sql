-- 唐无影（tang_wuying）：名单、@ 识别、私聊 agent_ask、群开关、回复和记忆能写
-- 自带数据：开头清理上一次的测试用户，结尾再清理
\set ON_ERROR_STOP on
\set QUIET on

delete from auth.users where email like '%@tangwuying-test.local';

create procedure pg_temp.as_user(u uuid) language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false);
  perform set_config('role', 'authenticated', false);
end $$;

create function pg_temp.err(q text) returns text language plpgsql as $$
begin
  execute q;
  return 'ok';
exception when others then
  return sqlerrm;
end $$;

create procedure pg_temp.expect(q text, expected text) language plpgsql as $$
declare got text := pg_temp.err(q);
begin
  if got is distinct from expected then
    raise exception 'expected [%] but got [%] for: %', expected, got, q;
  end if;
end $$;

do $$ begin
  if not 'tang_wuying' = any(public.agent_ids()) then raise exception 'agent_ids: %', public.agent_ids(); end if;
  if not public.agent_mentioned('tang_wuying', '@唐无影 在吗') or not public.agent_mentioned('tang_wuying', '少门主＠唐无影') then raise exception 'mention not recognised'; end if;
  if public.agent_mentioned('tang_wuying', '唐无影今天不在') or public.agent_mentioned('tang_wuying', '@叶英 你好')
     or public.agent_mentioned('ye_ying', '@唐无影') then raise exception 'false mention'; end if;
  if public.group_agent_name('tang_wuying') <> '唐无影' then raise exception 'name'; end if;
end $$;

insert into auth.users (id, email) values
  ('ae100000-0000-0000-0000-00000000000a', 'tw_alice@tangwuying-test.local'),
  ('ae100000-0000-0000-0000-00000000000b', 'tw_bob@tangwuying-test.local');
insert into public.friendships (requester_id, addressee_id, status) values
  ('ae100000-0000-0000-0000-00000000000a', 'ae100000-0000-0000-0000-00000000000b', 'accepted');

call pg_temp.as_user('ae100000-0000-0000-0000-00000000000a');
do $$
declare m public.messages; j public.agent_jobs;
begin
  m := public.send_message('ae100000-0000-0000-0000-00000000000b', '@唐无影 栈道的灯还亮着吗');
  perform set_config('tw.dm', m.id::text, false);
  j := public.agent_ask(m.id, 'tang_wuying');
  if j.agent_id <> 'tang_wuying' or j.status <> 'pending' then raise exception 'job: %', j; end if;
end $$;
call pg_temp.expect(format($$select public.agent_ask(%s, 'ye_ying')$$, current_setting('tw.dm')), 'agent_not_mentioned');

do $$
declare g public.groups; m public.messages;
begin
  g := public.create_group('唐家堡', array['ae100000-0000-0000-0000-00000000000b']::uuid[]);
  perform set_config('tw.g', g.id::text, false);
  m := public.send_group_message(g.id, '@唐无影 今晚谁巡夜');
  perform set_config('tw.gm', m.id::text, false);
end $$;
call pg_temp.expect(format($$select public.agent_ask_group(%s, 'tang_wuying')$$, current_setting('tw.gm')), 'agent_not_enabled');
do $$
declare g public.groups; j public.agent_jobs;
begin
  g := public.set_group_agents(current_setting('tw.g')::bigint, array['tang_wuying']);
  if g.agents <> array['tang_wuying'] then raise exception 'agents: %', g.agents; end if;
  if (select count(*) from public.messages m where m.group_id = g.id and m.author = 'system' and m.body like '% 打开了唐无影') <> 1 then raise exception 'system line'; end if;
  j := public.agent_ask_group(current_setting('tw.gm')::bigint, 'tang_wuying');
  if j.agent_id <> 'tang_wuying' or j.group_id <> g.id then raise exception 'group job: %', j; end if;
end $$;

-- 不限次数：群里也一样，24 小时里问过 60 次照样能问
reset role;
update public.agent_jobs set status = 'done' where group_id = current_setting('tw.g')::bigint;
insert into public.messages (sender_id, receiver_id, body)
select 'ae100000-0000-0000-0000-00000000000a', 'ae100000-0000-0000-0000-00000000000b', '@唐无影 批量 ' || i from generate_series(1, 60) as i;
insert into public.agent_jobs (asker, peer, message_id, agent_id, status)
select 'ae100000-0000-0000-0000-00000000000a', 'ae100000-0000-0000-0000-00000000000b', m.id, 'tang_wuying', 'done'
  from public.messages m where m.body like '@唐无影 批量 %' and m.sender_id = 'ae100000-0000-0000-0000-00000000000a';
call pg_temp.as_user('ae100000-0000-0000-0000-00000000000a');
do $$
declare g public.groups; m public.messages; j public.agent_jobs;
begin
  g := public.set_group_agents(current_setting('tw.g')::bigint, array['tang_wuying', 'ye_ying']);
  m := public.send_group_message(current_setting('tw.g')::bigint, '@叶英 @唐无影 第六十一个');
  j := public.agent_ask_group(m.id, 'ye_ying');
  if j.agent_id <> 'ye_ying' then raise exception 'unlimited group ask: %', j; end if;
end $$;

reset role;
call pg_temp.expect($$insert into public.messages (sender_id, receiver_id, body, author) values ('ae100000-0000-0000-0000-00000000000a', 'ae100000-0000-0000-0000-00000000000b', '先说你亲眼见到的。', 'tang_wuying')$$, 'ok');
call pg_temp.expect($$insert into public.agent_memories (user_lo, user_hi, agent_id, title, content) values ('ae100000-0000-0000-0000-00000000000a', 'ae100000-0000-0000-0000-00000000000b', 'tang_wuying', '栈道·灯', '上回说夜里看不清')$$, 'ok');
call pg_temp.expect(format($$insert into public.agent_group_memories (group_id, agent_id, title, content) values (%s, 'tang_wuying', '唐家堡·巡夜', '东段路难走')$$, current_setting('tw.g')), 'ok');

delete from auth.users where email like '%@tangwuying-test.local';
select 'tang wuying agent tests passed';
