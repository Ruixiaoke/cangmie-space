-- 谢云流（xie_yunliu）、李忘生（li_wangsheng）和集中后的 agent 名单：agent_ids / agent_mentioned / 约束 / agent_ask / 群开关
-- 自带数据：开头清理上一次的测试用户，结尾再清理
\set ON_ERROR_STOP on
\set QUIET on

delete from auth.users where email like '%@newagent-test.local';

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

-- 名单和 @ 识别
do $$ begin
  if public.agent_ids() <> array['durian', 'ye_ying', 'xie_yunliu', 'li_wangsheng'] then raise exception 'agent_ids: %', public.agent_ids(); end if;
  if not public.agent_mentioned('xie_yunliu', '@谢云流 喝酒吗') or not public.agent_mentioned('xie_yunliu', '你好＠谢云流')
     or not public.agent_mentioned('li_wangsheng', '@李忘生 早') or not public.agent_mentioned('durian', '@榴莲 在吗')
     or not public.agent_mentioned('ye_ying', '@叶英') then raise exception 'mention not recognised'; end if;
  if public.agent_mentioned('xie_yunliu', '谢云流今天没来') or public.agent_mentioned('li_wangsheng', '@谢云流 师弟呢')
     or public.agent_mentioned('nobody', '@谢云流') or public.agent_mentioned('xie_yunliu', null) then raise exception 'false mention'; end if;
  if public.group_agent_name('xie_yunliu') <> '谢云流' or public.group_agent_name('li_wangsheng') <> '李忘生' or public.group_agent_name('ye_ying') <> '叶英' then raise exception 'names'; end if;
end $$;

insert into auth.users (id, email) values
  ('ae000000-0000-0000-0000-00000000000a', 'na_alice@newagent-test.local'),
  ('ae000000-0000-0000-0000-00000000000b', 'na_bob@newagent-test.local');
insert into public.friendships (requester_id, addressee_id, status) values
  ('ae000000-0000-0000-0000-00000000000a', 'ae000000-0000-0000-0000-00000000000b', 'accepted');

-- 私聊：@谢云流 和 @李忘生 各建一个任务；没 @ 到的 agent 不行
call pg_temp.as_user('ae000000-0000-0000-0000-00000000000a');
do $$
declare m public.messages; j public.agent_jobs;
begin
  m := public.send_message('ae000000-0000-0000-0000-00000000000b', '@谢云流 @李忘生 你们俩谁先说');
  perform set_config('na.dm', m.id::text, false);
  j := public.agent_ask(m.id, 'xie_yunliu');
  if j.agent_id <> 'xie_yunliu' or j.status <> 'pending' then raise exception 'xie job: %', j; end if;
  j := public.agent_ask(m.id, 'li_wangsheng');
  if j.agent_id <> 'li_wangsheng' then raise exception 'li job: %', j; end if;
end $$;
call pg_temp.expect(format($$select public.agent_ask(%s, 'ye_ying')$$, current_setting('na.dm')), 'agent_not_mentioned');
call pg_temp.expect(format($$select public.agent_ask(%s, 'xie_yunliu')$$, current_setting('na.dm')), 'agent_busy');
call pg_temp.expect(format($$select public.agent_ask(%s, 'somebody')$$, current_setting('na.dm')), 'agent_not_mentioned');

-- 群：新 agent 默认关着；打开后能 @，系统提示行用中文名
do $$
declare g public.groups; m public.messages; j public.agent_jobs;
begin
  g := public.create_group('师门', array['ae000000-0000-0000-0000-00000000000b']::uuid[]);
  perform set_config('na.g', g.id::text, false);
  m := public.send_group_message(g.id, '@李忘生 师兄回来了吗');
  perform set_config('na.gm', m.id::text, false);
end $$;
call pg_temp.expect(format($$select public.agent_ask_group(%s, 'li_wangsheng')$$, current_setting('na.gm')), 'agent_not_enabled');
do $$
declare g public.groups; j public.agent_jobs;
begin
  g := public.set_group_agents(current_setting('na.g')::bigint, array['li_wangsheng', 'xie_yunliu']);
  if g.agents <> array['li_wangsheng', 'xie_yunliu'] then raise exception 'agents: %', g.agents; end if;
  if (select count(*) from public.messages m where m.group_id = g.id and m.author = 'system' and m.body like '% 打开了李忘生') <> 1
     or (select count(*) from public.messages m where m.group_id = g.id and m.author = 'system' and m.body like '% 打开了谢云流') <> 1 then raise exception 'system lines'; end if;
  j := public.agent_ask_group(current_setting('na.gm')::bigint, 'li_wangsheng');
  if j.agent_id <> 'li_wangsheng' or j.group_id <> g.id then raise exception 'group job: %', j; end if;
end $$;
call pg_temp.expect(format($$select public.set_group_agents(%s, array['somebody'])$$, current_setting('na.g')), 'invalid_argument');

-- 约束：新 agent 的回复和记忆能写（模拟 Edge Function 的写入），没登记的 agent 写不进
reset role;
call pg_temp.expect($$insert into public.messages (sender_id, receiver_id, body, author) values ('ae000000-0000-0000-0000-00000000000a', 'ae000000-0000-0000-0000-00000000000b', '有话直说。', 'xie_yunliu')$$, 'ok');
call pg_temp.expect($$insert into public.messages (sender_id, receiver_id, body, author) values ('ae000000-0000-0000-0000-00000000000a', 'ae000000-0000-0000-0000-00000000000b', 'x', 'nobody')$$, 'new row for relation "messages" violates check constraint "messages_author_valid"');
call pg_temp.expect($$insert into public.agent_memories (user_lo, user_hi, agent_id, title, content) values ('ae000000-0000-0000-0000-00000000000a', 'ae000000-0000-0000-0000-00000000000b', 'li_wangsheng', '师兄·近况', '在翁洲')$$, 'ok');
call pg_temp.expect($$insert into public.agent_memories (user_lo, user_hi, agent_id, title, content) values ('ae000000-0000-0000-0000-00000000000a', 'ae000000-0000-0000-0000-00000000000b', 'nobody', 't', 'c')$$, 'new row for relation "agent_memories" violates check constraint "agent_memories_agent_valid"');
call pg_temp.expect(format($$insert into public.agent_group_memories (group_id, agent_id, title, content) values (%s, 'xie_yunliu', '师门·旧事', '那半句话')$$, current_setting('na.g')), 'ok');
call pg_temp.expect(format($$update public.groups set agents = array['nobody'] where id = %s$$, current_setting('na.g')), 'new row for relation "groups" violates check constraint "groups_agents_valid"');

-- 清理
delete from auth.users where email like '%@newagent-test.local';
select 'new agent tests passed';
