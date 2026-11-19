-- 斗地主排行榜（ddz_leaderboard）的测试：好友榜把群行和私聊行加起来 / 不含非好友 / 本群榜只算这个群 / 非成员被拒 / 按积分再按胜场排序 / 负分 / 只有我可以是 0 局，CI 在临时 Postgres 上运行
\set ON_ERROR_STOP on
\set QUIET on

delete from auth.users where email like '%@ddzlb-test.local';

create procedure pg_temp.as_user(u uuid) language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false);
  perform set_config('role', 'authenticated', false);
end $$;

create procedure pg_temp.as_anon() language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);
  perform set_config('role', 'anon', false);
end $$;

create procedure pg_temp.as_admin() language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);
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


insert into auth.users (id, email) values
  ('d9000000-0000-0000-0000-00000000000a', 'a_me@ddzlb-test.local'),
  ('d9000000-0000-0000-0000-00000000000b', 'b_bob@ddzlb-test.local'),
  ('d9000000-0000-0000-0000-00000000000c', 'c_carol@ddzlb-test.local'),
  ('d9000000-0000-0000-0000-00000000000d', 'd_dan@ddzlb-test.local'),
  ('d9000000-0000-0000-0000-00000000000e', 'e_erin@ddzlb-test.local'),
  ('d9000000-0000-0000-0000-00000000000f', 'f_gus@ddzlb-test.local');

-- me 的好友：bob、dan、erin；carol 不是我的好友（bob 的好友）；gus 只认识 dan
insert into public.friendships (requester_id, addressee_id, status) values
  ('d9000000-0000-0000-0000-00000000000a', 'd9000000-0000-0000-0000-00000000000b', 'accepted'),
  ('d9000000-0000-0000-0000-00000000000d', 'd9000000-0000-0000-0000-00000000000a', 'accepted'),
  ('d9000000-0000-0000-0000-00000000000a', 'd9000000-0000-0000-0000-00000000000e', 'accepted'),
  ('d9000000-0000-0000-0000-00000000000b', 'd9000000-0000-0000-0000-00000000000c', 'accepted'),
  ('d9000000-0000-0000-0000-00000000000f', 'd9000000-0000-0000-0000-00000000000d', 'accepted');

-- 群 1：me bob carol dan；群 2：me bob erin（carol 不在）
do $$
declare g1 bigint; g2 bigint;
begin
  insert into public.groups (name, owner_id) values ('lb 群一', 'd9000000-0000-0000-0000-00000000000a') returning id into g1;
  insert into public.groups (name, owner_id) values ('lb 群二', 'd9000000-0000-0000-0000-00000000000a') returning id into g2;
  insert into public.group_members (group_id, user_id) values
    (g1, 'd9000000-0000-0000-0000-00000000000a'), (g1, 'd9000000-0000-0000-0000-00000000000b'),
    (g1, 'd9000000-0000-0000-0000-00000000000c'), (g1, 'd9000000-0000-0000-0000-00000000000d'),
    (g2, 'd9000000-0000-0000-0000-00000000000a'), (g2, 'd9000000-0000-0000-0000-00000000000b'),
    (g2, 'd9000000-0000-0000-0000-00000000000e')
  on conflict do nothing;
  perform set_config('z.g1', g1::text, false);
  perform set_config('z.g2', g2::text, false);
  -- 积分行 (total, games, wins)
  insert into public.ddz_scores (group_id, user_id, total, games, wins) values
    (g1, 'd9000000-0000-0000-0000-00000000000a', 10, 3, 2),
    (g1, 'd9000000-0000-0000-0000-00000000000b', -4, 3, 1),
    (g1, 'd9000000-0000-0000-0000-00000000000c', 7, 2, 1),
    (g2, 'd9000000-0000-0000-0000-00000000000a', -3, 1, 0),
    (g2, 'd9000000-0000-0000-0000-00000000000b', 2, 2, 1),
    (g2, 'd9000000-0000-0000-0000-00000000000e', 12, 9, 5);
  -- 私聊对：me-bob、bob-carol（dm_lo < dm_hi）
  insert into public.ddz_scores (dm_lo, dm_hi, user_id, total, games, wins) values
    ('d9000000-0000-0000-0000-00000000000a', 'd9000000-0000-0000-0000-00000000000b', 'd9000000-0000-0000-0000-00000000000a', 5, 2, 1),
    ('d9000000-0000-0000-0000-00000000000a', 'd9000000-0000-0000-0000-00000000000b', 'd9000000-0000-0000-0000-00000000000b', -5, 2, 1),
    ('d9000000-0000-0000-0000-00000000000b', 'd9000000-0000-0000-0000-00000000000c', 'd9000000-0000-0000-0000-00000000000b', 20, 4, 3),
    ('d9000000-0000-0000-0000-00000000000b', 'd9000000-0000-0000-0000-00000000000c', 'd9000000-0000-0000-0000-00000000000c', -20, 4, 1);
end $$;

-- 一行：用 id 认人（不依赖昵称），格式 字母:积分/胜/局，逗号隔开，保持函数返回的顺序
create function pg_temp.line(q text) returns text language plpgsql as $$
declare r text;
begin
  execute 'select string_agg(right(user_id::text, 1) || '':'' || total || ''/'' || wins || ''/'' || games, '','') from (' || q || ') x' into r;
  return r;
end $$;

-- 匿名、没登录都不行
call pg_temp.as_anon();
call pg_temp.expect($$select * from public.ddz_leaderboard()$$, 'permission denied for function ddz_leaderboard');
reset role;
select set_config('request.jwt.claims', '', false);
select set_config('role', 'authenticated', false);
call pg_temp.expect($$select * from public.ddz_leaderboard()$$, 'not_authenticated');

-- 好友榜（me）：群行 + 私聊行加起来；carol 不是好友不出现；dan 没玩过不出现
--   bob  = -4 + 2 - 5 + 20 = 13 积分，1+1+1+3 = 6 胜，3+2+2+4 = 11 局
--   erin = 12 积分 5 胜 9 局；me = 10 - 3 + 5 = 12 积分 3 胜 6 局（同分，胜场少排在 erin 后面）
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000a');
do $$
declare got text;
begin
  got := pg_temp.line('select * from public.ddz_leaderboard()');
  if got <> 'b:13/6/11,e:12/5/9,a:12/3/6' then raise exception 'friends board wrong: %', got; end if;
  got := pg_temp.line('select * from public.ddz_leaderboard(null)');
  if got <> 'b:13/6/11,e:12/5/9,a:12/3/6' then raise exception 'friends board (null) wrong: %', got; end if;
end $$;

-- 本群榜（群 1）：只算群 1 的行；carol（非好友）在群里所以出现；dan 没有群行不出现；bob 是负分
do $$
declare got text;
begin
  got := pg_temp.line('select * from public.ddz_leaderboard(' || current_setting('z.g1') || ')');
  if got <> 'a:10/2/3,c:7/1/2,b:-4/1/3' then raise exception 'group 1 board wrong: %', got; end if;
  got := pg_temp.line('select * from public.ddz_leaderboard(' || current_setting('z.g2') || ')');
  if got <> 'e:12/5/9,b:2/1/2,a:-3/0/1' then raise exception 'group 2 board wrong: %', got; end if;
end $$;
-- 不存在的群、没加入的群
call pg_temp.expect($$select * from public.ddz_leaderboard(999999999)$$, 'not_group_member');

-- carol：好友只有 bob；不在群 2，被拒；群 1 照常
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000c');
call pg_temp.expect($$select * from public.ddz_leaderboard(current_setting('z.g2')::bigint)$$, 'not_group_member');
do $$
declare got text;
begin
  got := pg_temp.line('select * from public.ddz_leaderboard()');
  if got <> 'b:13/6/11,c:-13/2/6' then raise exception 'carol friends board wrong: %', got; end if;
  if exists (select 1 from public.ddz_leaderboard() where user_id = 'd9000000-0000-0000-0000-00000000000a') then
    raise exception 'carol sees non-friend me';
  end if;
end $$;

-- dan 自己没玩过也显示（0 分 0 局）；好友 me 在榜上，gus 没玩过不出现
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000d');
do $$
declare got text;
begin
  got := pg_temp.line('select * from public.ddz_leaderboard()');
  if got <> 'a:12/3/6,d:0/0/0' then raise exception 'dan board wrong: %', got; end if;
  got := pg_temp.line('select * from public.ddz_leaderboard(' || current_setting('z.g1') || ')');
  if got <> 'a:10/2/3,c:7/1/2,d:0/0/0,b:-4/1/3' then raise exception 'dan group board wrong: %', got; end if;
end $$;

-- gus 只有一个没玩过的好友：只显示自己，0 分
call pg_temp.as_user('d9000000-0000-0000-0000-00000000000f');
do $$
declare got text;
begin
  got := pg_temp.line('select * from public.ddz_leaderboard()');
  if got <> 'f:0/0/0' then raise exception 'gus board wrong: %', got; end if;
end $$;

-- game_leaderboard 的签名和返回类型没变
do $$
begin
  if (select pg_get_function_result(p.oid) from pg_proc p where p.proname = 'game_leaderboard' and p.pronamespace = 'public'::regnamespace)
     <> 'TABLE(user_id uuid, nickname text, avatar_path text, wins bigint, losses bigint)' then
    raise exception 'game_leaderboard return type changed';
  end if;
end $$;

reset role;
delete from auth.users where email like '%@ddzlb-test.local';
select 'ddz leaderboard tests ok';
