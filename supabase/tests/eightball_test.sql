-- 8球模式（pool_start 选模式、pool_shoot 的球组和判负、pool_rematch、排行榜拆分）的测试
-- 自带数据：开头清理上一次的测试用户，结尾再清理
\set ON_ERROR_STOP on
\set QUIET on

delete from auth.users where email like '%@pool8-test.local';

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
  ('e8000000-0000-0000-0000-0000000000a1', 'alice@pool8-test.local'),
  ('e8000000-0000-0000-0000-0000000000b1', 'bob@pool8-test.local'),
  ('e8000000-0000-0000-0000-0000000000c1', 'carol@pool8-test.local');

insert into public.friendships (requester_id, addressee_id, status) values
  ('e8000000-0000-0000-0000-0000000000a1', 'e8000000-0000-0000-0000-0000000000b1', 'accepted');

-- 最新一局的出杆小工具：方向和力度固定，只关心判定字段
-- 参数：回合, 台面, 落袋, 犯规, 赢, 继续, 球组, 输, 白球x, 白球y
create function pg_temp.shot(t int, res text, pot int[], foul text, win boolean, keep boolean, grp text, lose boolean, cx numeric default null, cy numeric default null)
returns jsonb language sql as $$
  select public.pool_shoot((select id from public.pool_games order by id desc limit 1), t, 0, -1, 0.5, cx, cy, res::jsonb, pot, foul, win, keep, grp, lose)
$$;
create function pg_temp.q(t int, res text, pot int[], foul text, win boolean, keep boolean, grp text, lose boolean)
returns text language plpgsql as $$
begin
  perform pg_temp.shot(t, res, pot, foul, win, keep, grp, lose);
  return 'ok';
end $$;
create function pg_temp.cur() returns public.pool_games language sql as $$
  select * from public.pool_games order by id desc limit 1
$$;

-- 匿名不能调用新签名
call pg_temp.as_anon();
call pg_temp.expect($$select public.pool_start('e8000000-0000-0000-0000-0000000000b1', 'eight')$$, 'permission denied for function pool_start');
call pg_temp.expect($$select public.pool_shoot(1, 1, 0, -1, 0.5, null, null, '{"b":[]}'::jsonb, '{}', null, false, false, null, false)$$, 'permission denied for function pool_shoot');
call pg_temp.expect($$select * from public.game_leaderboard('pool8')$$, 'permission denied for function game_leaderboard');

call pg_temp.as_user('e8000000-0000-0000-0000-0000000000a1');
-- 模式只能是 nine / eight；不是好友照样拒绝
call pg_temp.expect($$select public.pool_start('e8000000-0000-0000-0000-0000000000b1', 'ten')$$, 'invalid_argument');
call pg_temp.expect($$select public.pool_start('e8000000-0000-0000-0000-0000000000b1', null)$$, 'invalid_argument');
call pg_temp.expect($$select public.pool_start('e8000000-0000-0000-0000-0000000000c1', 'eight')$$, 'not_friends');
-- 旧的单参数调用还能用，默认 9球
do $$
declare g public.pool_games;
begin
  g := public.pool_start('e8000000-0000-0000-0000-0000000000b1');
  if g.mode <> 'nine' or g.group_a is not null then raise exception 'default mode must be nine'; end if;
  if (select body from public.messages where id = g.message_id) <> '[9球台球]#' || g.id then raise exception 'nine invite wrong'; end if;
  -- 旧的 12 参数出杆调用也还能用（9球），白球位置按开球
  perform public.pool_shoot(g.id, 1, 0, -1, 0.5, null, null, '{"b":[[0,170,300],[1,170,170]]}'::jsonb, '{}', null, false, false);
  perform public.pool_resign(g.id);
end $$;
call pg_temp.expect($$select public.pool_start('e8000000-0000-0000-0000-0000000000b1', 'eight') is not null$$, 'ok');

-- 开了 8球：模式存下来，消息是 [8球台球]#id；已有进行中的局再选别的模式也返回同一局
do $$
declare g public.pool_games; g2 public.pool_games;
begin
  g := pg_temp.cur();
  if g.mode <> 'eight' or g.status <> 'active' or g.next_player <> g.player_a or g.group_a is not null then raise exception 'eight game wrong'; end if;
  if (select body from public.messages where id = g.message_id) <> '[8球台球]#' || g.id then raise exception 'eight invite wrong'; end if;
  g2 := public.pool_start('e8000000-0000-0000-0000-0000000000b1', 'nine');
  if g2.id <> g.id or g2.mode <> 'eight' then raise exception 'active game should be reused as is'; end if;
  if (select count(*) from public.messages where body like '[8球台球]#%') <> 1 then raise exception 'duplicate eight message'; end if;
end $$;

-- ---- 第 1 盘：alice 开球 ----
-- 开球（台面还是摆好的）：不能分组、不能判输赢；球号可以到 15；落袋的 8 号要放回台面
call pg_temp.expect($$select pg_temp.q(1, '{"b":[[0,170,450],[1,170,170],[8,170,130]]}', '{1}', null, false, true, 'solid', false)$$, 'invalid_shot'); -- 开球不分组
call pg_temp.expect($$select pg_temp.q(1, '{"b":[[0,170,450],[1,170,170]]}', '{8}', null, false, false, null, true)$$, 'invalid_shot'); -- 开球不判输
call pg_temp.expect($$select pg_temp.q(1, '{"b":[[0,170,450],[1,170,170]]}', '{8}', null, true, false, null, false)$$, 'invalid_shot'); -- 开球不判赢
call pg_temp.expect($$select pg_temp.q(1, '{"b":[[0,170,450],[1,170,170]]}', '{8}', null, false, false, null, false)$$, 'invalid_shot'); -- 开球 8 号落袋必须放回台面
call pg_temp.expect($$select pg_temp.q(1, '{"b":[[0,170,450],[16,170,170]]}', '{}', null, false, false, null, false)$$, 'invalid_shot'); -- 球号 0..15
call pg_temp.expect($$select pg_temp.q(1, '{"b":[[0,170,450]]}', '{16}', null, false, false, null, false)$$, 'invalid_shot');
call pg_temp.expect($$select pg_temp.q(1, '{"b":[[0,170,450]]}', '{}', null, false, false, 'bogus', false)$$, 'invalid_shot');
-- 开球：打进 8 号放回置球点（8 号还在台面上、没输赢），没有进别的球，轮到 bob
do $$
declare g public.pool_games;
begin
  g := jsonb_populate_record(null::public.pool_games, pg_temp.shot(1, '{"b":[[0,170,450],[8,170,170],[1,200,150],[2,100,100],[9,60,60],[10,80,80],[11,300,300],[12,40,500]]}', '{8}', null, false, false, null, false) -> 'game');
  if g.next_player <> 'e8000000-0000-0000-0000-0000000000b1' or g.status <> 'active' or g.group_a is not null or g.turn_no <> 2 or g.in_hand then raise exception 'eight break wrong'; end if;
  if jsonb_array_length(g.state -> 'b') <> 8 then raise exception 'state of 8 balls not stored'; end if;
end $$;

-- ---- bob：分组 ----
call pg_temp.as_user('e8000000-0000-0000-0000-0000000000b1');
call pg_temp.expect($$select pg_temp.q(2, '{"b":[[0,170,450],[8,170,170],[1,200,150],[2,100,100],[9,60,60],[11,300,300],[12,40,500]]}', '{10}', null, false, true, 'solid', false)$$, 'invalid_shot'); -- 进的是花色，不能说全色
call pg_temp.expect($$select pg_temp.q(2, '{"b":[[0,170,450],[8,170,170],[1,200,150],[2,100,100],[9,60,60],[11,300,300],[12,40,500]]}', '{10}', null, false, false, 'stripe', false)$$, 'invalid_shot'); -- 分组必须继续出杆
call pg_temp.expect($$select pg_temp.q(2, '{"b":[[8,170,170],[1,200,150],[2,100,100],[9,60,60],[11,300,300],[12,40,500]]}', '{0,10}', 'scratch', false, false, 'stripe', false)$$, 'invalid_shot'); -- 犯规不能分组
call pg_temp.expect($$select pg_temp.q(2, '{"b":[[0,170,450],[8,170,170],[1,200,150],[2,100,100],[9,60,60],[11,300,300],[12,40,500]]}', '{8}', null, false, true, 'stripe', false)$$, 'invalid_shot'); -- 进的球里没有这一组
call pg_temp.expect($$select pg_temp.q(2, '{"b":[[0,170,450],[1,200,150],[2,100,100],[9,60,60],[11,300,300],[12,40,500]]}', '{8,10}', null, false, true, null, true)$$, 'invalid_shot'); -- 输和继续互斥
call pg_temp.expect($$select pg_temp.q(2, '{"b":[[0,170,450],[1,200,150],[2,100,100],[9,60,60],[11,300,300],[12,40,500]]}', '{10}', null, false, false, null, true)$$, 'invalid_shot'); -- 输必须 8 号落袋
call pg_temp.expect($$select pg_temp.q(2, '{"b":[[0,170,450],[8,170,170],[1,200,150]]}', '{8}', null, false, false, null, true)$$, 'invalid_shot'); -- 输的话 8 号不能还在台面上
call pg_temp.expect($$select pg_temp.q(2, '{"b":[[0,170,450],[1,200,150]]}', '{8}', null, true, false, null, false)$$, 'invalid_shot'); -- 还没分组不能赢
call pg_temp.expect($$select pg_temp.q(2, '{"b":[[0,170,450],[1,200,150]]}', '{8}', null, true, false, null, true)$$, 'invalid_shot'); -- 赢和输互斥
call pg_temp.expect($$select pg_temp.q(2, '{"b":[[0,170,450],[8,170,170]]}', '{8}', null, false, false, null, false)$$, 'invalid_shot'); -- 非开球 8 号落袋必须判输赢
do $$
declare g public.pool_games; r jsonb;
begin
  r := pg_temp.shot(2, '{"b":[[0,170,450],[8,170,170],[1,200,150],[2,100,100],[9,60,60],[11,300,300],[12,40,500]]}', '{10}', null, false, true, 'stripe', false);
  g := jsonb_populate_record(null::public.pool_games, r -> 'game');
  -- bob 是 B，花色 → A 是全色
  if g.group_a <> 'solid' or g.next_player <> 'e8000000-0000-0000-0000-0000000000b1' or g.status <> 'active' then raise exception 'group assign wrong: % %', g.group_a, g.next_player; end if;
  if (select count(*) from public.pool_shots where id = (r ->> 'shot_id')::bigint and grp = 'stripe' and keep and not lost) <> 1 then raise exception 'shot grp not recorded'; end if;
end $$;
-- 已经分组：不能再给；换成别的组也不行
call pg_temp.expect($$select pg_temp.q(3, '{"b":[[0,170,450],[8,170,170],[1,200,150],[9,60,60],[11,300,300],[12,40,500]]}', '{2}', null, false, true, 'solid', false)$$, 'invalid_shot');
-- 进了对方的球：照样继续（服务器只看自洽），不给分组
do $$
declare g public.pool_games;
begin
  g := jsonb_populate_record(null::public.pool_games, pg_temp.shot(3, '{"b":[[0,170,450],[8,170,170],[1,200,150],[9,60,60],[11,300,300],[12,40,500]]}', '{2}', null, false, true, null, false) -> 'game');
  if g.group_a <> 'solid' or g.turn_no <> 4 then raise exception 'group must stay'; end if;
end $$;
-- 自己的球组还没清空就打进 8 号：判输，alice 赢这盘、记一分
call pg_temp.expect($$select pg_temp.q(4, '{"b":[[0,170,450],[1,200,150]]}', '{8}', null, true, false, null, false)$$, 'invalid_shot'); -- 9 11 12 还在台面上，不能赢
do $$
declare g public.pool_games; r jsonb;
begin
  r := pg_temp.shot(4, '{"b":[[0,170,450],[1,200,150],[9,60,60],[11,300,300],[12,40,500]]}', '{8}', null, false, false, null, true);
  g := jsonb_populate_record(null::public.pool_games, r -> 'game');
  if g.status <> 'rack_over' or g.winner <> 'e8000000-0000-0000-0000-0000000000a1' or g.next_player is not null or g.score_a <> 1 or g.score_b <> 0 then raise exception 'early 8 must lose: % % % %', g.status, g.winner, g.score_a, g.score_b; end if;
  if (select count(*) from public.pool_shots where id = (r ->> 'shot_id')::bigint and lost and not won and not keep) <> 1 then raise exception 'lost not recorded'; end if;
end $$;
call pg_temp.expect($$select pg_temp.q(5, '{"b":[[0,170,450]]}', '{}', null, false, false, null, false)$$, 'game_over');

-- ---- 第 2 盘：再来一盘，模式不变、分组清空、bob 开球 ----
do $$
declare g public.pool_games;
begin
  call pg_temp.as_user('e8000000-0000-0000-0000-0000000000a1');
  g := public.pool_rematch((select id from public.pool_games order by id desc limit 1));
  if g.mode <> 'eight' or g.group_a is not null or g.rack_no <> 2 or g.state is not null or g.score_a <> 1 then raise exception 'rematch must keep mode and reset groups'; end if;
  if g.next_player <> 'e8000000-0000-0000-0000-0000000000b1' then raise exception 'bob breaks rack 2'; end if;
end $$;
call pg_temp.as_user('e8000000-0000-0000-0000-0000000000b1');
do $$
declare g public.pool_games;
begin
  g := jsonb_populate_record(null::public.pool_games, pg_temp.shot((pg_temp.cur()).turn_no, '{"b":[[0,170,450],[8,170,170],[3,200,150],[11,60,60]]}', '{}', null, false, false, null, false) -> 'game');
  if g.next_player <> 'e8000000-0000-0000-0000-0000000000a1' then raise exception 'alice next'; end if;
end $$;
call pg_temp.as_user('e8000000-0000-0000-0000-0000000000a1');
-- alice（A）进了全色 3，分到全色；A 的组就是 solid
do $$
declare g public.pool_games; t int := (pg_temp.cur()).turn_no;
begin
  g := jsonb_populate_record(null::public.pool_games, pg_temp.shot(t, '{"b":[[0,170,450],[8,170,170],[11,60,60]]}', '{3}', null, false, true, 'solid', false) -> 'game');
  if g.group_a <> 'solid' or g.next_player <> 'e8000000-0000-0000-0000-0000000000a1' then raise exception 'alice group wrong'; end if;
end $$;
-- 全色清空了：合法打进 8 号赢；球还在台面上（8 号）不行；必须没犯规
do $$ declare t int := (pg_temp.cur()).turn_no; begin
  call pg_temp.expect(format($q$select pg_temp.q(%s, '{"b":[[0,170,450],[8,170,170],[11,60,60]]}', '{8}', null, true, false, null, false)$q$, t), 'invalid_shot'); -- 8 号不能还在台面上
  call pg_temp.expect(format($q$select pg_temp.q(%s, '{"b":[[11,60,60]]}', '{0,8}', 'scratch', true, false, null, false)$q$, t), 'invalid_shot'); -- 犯规不能赢
end $$;
do $$
declare g public.pool_games; r jsonb; t int := (pg_temp.cur()).turn_no;
begin
  r := pg_temp.shot(t, '{"b":[[0,170,450],[11,60,60]]}', '{8}', null, true, false, null, false);
  g := jsonb_populate_record(null::public.pool_games, r -> 'game');
  if g.status <> 'rack_over' or g.winner <> 'e8000000-0000-0000-0000-0000000000a1' or g.score_a <> 2 or g.score_b <> 0 then raise exception 'clean 8 must win: % % % %', g.status, g.winner, g.score_a, g.score_b; end if;
  if (select count(*) from public.pool_shots where id = (r ->> 'shot_id')::bigint and won and not lost) <> 1 then raise exception 'won not recorded'; end if;
end $$;

-- ---- 第 3 盘：alice 开球；bob 打 8 号时犯规 = 输（白球拿起来，盘结束，不留自由球）----
do $$
declare g public.pool_games;
begin
  g := public.pool_rematch((pg_temp.cur()).id);
  if g.next_player <> 'e8000000-0000-0000-0000-0000000000a1' or g.rack_no <> 3 then raise exception 'alice breaks rack 3'; end if;
  g := jsonb_populate_record(null::public.pool_games, pg_temp.shot(g.turn_no, '{"b":[[0,170,450],[8,170,170],[3,200,150],[11,60,60]]}', '{}', null, false, false, null, false) -> 'game');
end $$;
call pg_temp.as_user('e8000000-0000-0000-0000-0000000000b1');
do $$
declare g public.pool_games; r jsonb; t int := (pg_temp.cur()).turn_no;
begin
  -- 白球落袋没写 scratch：自相矛盾
  call pg_temp.expect(format($q$select pg_temp.q(%s, '{"b":[[11,60,60]]}', '{0,8}', null, false, false, null, true)$q$, t), 'invalid_shot');
  r := pg_temp.shot(t, '{"b":[[3,200,150],[11,60,60]]}', '{0,8}', 'scratch', false, false, null, true);
  g := jsonb_populate_record(null::public.pool_games, r -> 'game');
  if g.status <> 'rack_over' or g.winner <> 'e8000000-0000-0000-0000-0000000000a1' or g.score_a <> 3 or g.score_b <> 0 or g.in_hand or g.last_foul <> 'scratch' then
    raise exception 'foul 8 must lose: % % % % % %', g.status, g.winner, g.score_a, g.score_b, g.in_hand, g.last_foul;
  end if;
end $$;

-- ---- 9球 不受影响：p_group / p_lose 被忽略，球号 > 9 仍然非法，结果跟以前一样 ----
call pg_temp.as_user('e8000000-0000-0000-0000-0000000000a1');
do $$
declare g public.pool_games; r jsonb;
begin
  -- 结束的 8球 局之后再开：新开一局（9球）
  g := public.pool_start('e8000000-0000-0000-0000-0000000000b1', 'nine');
  if g.mode <> 'nine' or g.score_a <> 0 or g.score_b <> 0 then raise exception 'new nine game wrong'; end if;
  begin perform pg_temp.shot(1, '{"b":[[0,170,450],[10,170,170]]}', '{}', null, false, false, null, false); raise exception 'ball 10 must be invalid in nine';
  exception when others then if sqlerrm <> 'invalid_shot' then raise; end if; end;
  begin perform pg_temp.shot(1, '{"b":[[0,170,450]]}', '{12}', null, false, false, null, false); raise exception 'potted 12 must be invalid in nine';
  exception when others then if sqlerrm <> 'invalid_shot' then raise; end if; end;
  -- 带了球组和输：9球 直接忽略；这是一杆合法的开球，轮到 bob，没有分组、没有输赢
  r := pg_temp.shot(1, '{"b":[[0,170,450],[1,170,170],[9,200,150]]}', '{}', null, false, false, 'solid', true);
  g := jsonb_populate_record(null::public.pool_games, r -> 'game');
  if g.status <> 'active' or g.group_a is not null or g.winner is not null or g.score_a <> 0 or g.score_b <> 0 or g.next_player <> 'e8000000-0000-0000-0000-0000000000b1' then raise exception 'nine must ignore group/lose'; end if;
  if (select count(*) from public.pool_shots where id = (r ->> 'shot_id')::bigint and not lost and grp is null) <> 1 then raise exception 'nine shot must not record lost/grp'; end if;
  -- 9球 的赢仍然是 9 号落袋
  call pg_temp.as_user('e8000000-0000-0000-0000-0000000000b1');
  r := pg_temp.shot(2, '{"b":[[0,170,450],[1,170,170]]}', '{9}', null, true, false, null, false);
  g := jsonb_populate_record(null::public.pool_games, r -> 'game');
  if g.status <> 'rack_over' or g.winner <> 'e8000000-0000-0000-0000-0000000000b1' or g.score_b <> 1 then raise exception 'nine win broke'; end if;
  -- 9球 打进 8 号不是什么特别的事
  g := public.pool_rematch(g.id);
end $$;

-- 排行榜拆分：8球 的盘数不进 'pool'，9球 的不进 'pool8'
call pg_temp.as_user('e8000000-0000-0000-0000-0000000000a1');
do $$
declare p text; p8 text;
begin
  select string_agg(nickname || ':' || wins || '-' || losses, ',' order by nickname) into p8 from public.game_leaderboard('pool8') where user_id in ('e8000000-0000-0000-0000-0000000000a1', 'e8000000-0000-0000-0000-0000000000b1');
  select string_agg(nickname || ':' || wins || '-' || losses, ',' order by nickname) into p from public.game_leaderboard('pool') where user_id in ('e8000000-0000-0000-0000-0000000000a1', 'e8000000-0000-0000-0000-0000000000b1');
  -- 8球：alice 赢 3 盘（对方早打 8 号、自己清台、对方犯规打 8 号）；9球：bob 赢 2 盘（alice 认输一盘 + 打进 9 号一盘）
  if p8 not like '%:3-0%' or p8 not like '%:0-3%' then raise exception 'pool8 board wrong: %', p8; end if;
  if p not like '%:0-2%' or p not like '%:2-0%' then raise exception 'pool board wrong: %', p; end if;
end $$;

reset role;
delete from auth.users where email like '%@pool8-test.local';
select 'eightball tests ok';
