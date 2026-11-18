-- 井字棋（ttt_games、ttt_start / ttt_move / ttt_resign）的测试，CI 在临时 Postgres 上运行
-- 自带数据：开头清理上一次的测试用户，结尾再清理
\set ON_ERROR_STOP on
\set QUIET on

delete from auth.users where email like '%@ttt-test.local';

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
  ('e0000000-0000-0000-0000-0000000000a1', 'ttt_alice@ttt-test.local'),
  ('e0000000-0000-0000-0000-0000000000b1', 'ttt_bob@ttt-test.local'),
  ('e0000000-0000-0000-0000-0000000000c1', 'ttt_carol@ttt-test.local');

-- alice 和 bob 是好友；carol 和谁都不是
insert into public.friendships (requester_id, addressee_id, status) values
  ('e0000000-0000-0000-0000-0000000000a1', 'e0000000-0000-0000-0000-0000000000b1', 'accepted');

-- 匿名不能调用，也看不到表
call pg_temp.as_anon();
call pg_temp.expect($$select public.ttt_start('e0000000-0000-0000-0000-0000000000b1')$$, 'permission denied for function ttt_start');
call pg_temp.expect($$select public.ttt_move(1, 0)$$, 'permission denied for function ttt_move');
call pg_temp.expect($$select public.ttt_resign(1)$$, 'permission denied for function ttt_resign');

-- 没有写策略：登录用户也不能直接改表
call pg_temp.as_user('e0000000-0000-0000-0000-0000000000a1');
call pg_temp.expect($$insert into public.ttt_games (player_x, player_o) values ('e0000000-0000-0000-0000-0000000000a1', 'e0000000-0000-0000-0000-0000000000b1')$$, 'permission denied for table ttt_games');
call pg_temp.expect($$update public.ttt_games set board = 'xxxxxxxxx'$$, 'permission denied for table ttt_games');

-- 不是好友：被拒绝（对 carol、对自己、对空）
call pg_temp.expect($$select public.ttt_start('e0000000-0000-0000-0000-0000000000c1')$$, 'not_friends');
call pg_temp.expect($$select public.ttt_start('e0000000-0000-0000-0000-0000000000a1')$$, 'not_friends');
call pg_temp.expect($$select public.ttt_start(null)$$, 'not_friends');

-- 开局：alice 为 X 先手；聊天里多一条 [井字棋]#id，message_id 对上
do $$
declare g public.ttt_games; g2 public.ttt_games; m public.messages;
begin
  g := public.ttt_start('e0000000-0000-0000-0000-0000000000b1');
  if g.player_x <> 'e0000000-0000-0000-0000-0000000000a1' or g.player_o <> 'e0000000-0000-0000-0000-0000000000b1' then raise exception 'caller must be X'; end if;
  if g.next_player <> 'e0000000-0000-0000-0000-0000000000a1' then raise exception 'X must move first'; end if;
  if g.board <> '.........' or g.status <> 'active' or g.winner is not null or g.win_line is not null then
    raise exception 'new game state wrong'; end if;
  if g.message_id is null then raise exception 'message_id not linked'; end if;
  select * into m from public.messages where id = g.message_id;
  if m.body <> '[井字棋]#' || g.id or m.sender_id <> 'e0000000-0000-0000-0000-0000000000a1' or m.receiver_id <> 'e0000000-0000-0000-0000-0000000000b1' or m.read_at is not null then
    raise exception 'invite message wrong: %', m.body; end if;
  -- 进行中的再点一次：返回同一局，不新建对局也不新发消息
  g2 := public.ttt_start('e0000000-0000-0000-0000-0000000000b1');
  if g2.id <> g.id then raise exception 'active game should be reused'; end if;
  if (select count(*) from public.ttt_games) <> 1 then raise exception 'duplicate game created'; end if;
  if (select count(*) from public.messages where body like '[井字棋]#%') <> 1 then raise exception 'duplicate message'; end if;
end $$;
-- bob 那边点也是同一局
call pg_temp.as_user('e0000000-0000-0000-0000-0000000000b1');
do $$
declare g public.ttt_games;
begin
  g := public.ttt_start('e0000000-0000-0000-0000-0000000000a1');
  if g.player_x <> 'e0000000-0000-0000-0000-0000000000a1' then raise exception 'peer start should reuse the existing game'; end if;
  if (select count(*) from public.ttt_games) <> 1 then raise exception 'duplicate game from peer'; end if;
end $$;

-- 匿名看不到对局（CI 给 anon 配了默认的表权限，靠 RLS 挡住）
call pg_temp.as_anon();
do $$ begin
  if (select count(*) from public.ttt_games) <> 0 then raise exception 'anon can see games'; end if;
end $$;
call pg_temp.as_user('e0000000-0000-0000-0000-0000000000b1');

-- 轮次：bob 不能先走；carol 看不到也走不了
call pg_temp.expect($$select public.ttt_move((select id from public.ttt_games), 4)$$, 'not_your_turn');
call pg_temp.as_user('e0000000-0000-0000-0000-0000000000c1');
call pg_temp.expect($$select count(*) from public.ttt_games$$, 'ok');
do $$ begin
  if (select count(*) from public.ttt_games) <> 0 then raise exception 'non-player can see the game'; end if;
end $$;
call pg_temp.expect($$select public.ttt_move(999999999, 4)$$, 'game_not_found');
call pg_temp.expect($$select public.ttt_resign(999999999)$$, 'game_not_found');
reset role;
do $$ begin
  call pg_temp.as_user('e0000000-0000-0000-0000-0000000000c1');
  begin perform public.ttt_move((select id from public.ttt_games order by id desc limit 1), 4);
    raise exception 'non-player move should fail';
  exception when others then if sqlerrm <> 'game_not_found' then raise; end if; end;
  begin perform public.ttt_resign((select id from public.ttt_games order by id desc limit 1));
    raise exception 'non-player resign should fail';
  exception when others then if sqlerrm <> 'game_not_found' then raise; end if; end;
end $$;

-- alice 走 4；格子被占；无效格子；轮次交替
call pg_temp.as_user('e0000000-0000-0000-0000-0000000000a1');
do $$
declare gid bigint; g public.ttt_games;
begin
  select id into gid from public.ttt_games;
  call pg_temp.as_user('e0000000-0000-0000-0000-0000000000a1');
  g := public.ttt_move(gid, 4);
  if g.board <> '....x....' or g.next_player <> 'e0000000-0000-0000-0000-0000000000b1' then raise exception 'move 1 wrong: % %', g.board, g.next_player; end if;
  begin perform public.ttt_move(gid, 0); raise exception 'double move should fail';
  exception when others then if sqlerrm <> 'not_your_turn' then raise; end if; end;
  call pg_temp.as_user('e0000000-0000-0000-0000-0000000000b1');
  begin perform public.ttt_move(gid, 4); raise exception 'occupied should fail';
  exception when others then if sqlerrm <> 'cell_taken' then raise; end if; end;
  begin perform public.ttt_move(gid, 9); raise exception 'cell 9 should fail';
  exception when others then if sqlerrm <> 'invalid_cell' then raise; end if; end;
  begin perform public.ttt_move(gid, -1); raise exception 'cell -1 should fail';
  exception when others then if sqlerrm <> 'invalid_cell' then raise; end if; end;
  begin perform public.ttt_move(gid, null); raise exception 'null cell should fail';
  exception when others then if sqlerrm <> 'invalid_cell' then raise; end if; end;
  g := public.ttt_move(gid, 0);
  if g.board <> 'o...x....' or g.next_player <> 'e0000000-0000-0000-0000-0000000000a1' or g.status <> 'active' then raise exception 'move 2 wrong: %', g.board; end if;
  -- 认输：bob 认输，alice 赢
  g := public.ttt_resign(gid);
  if g.status <> 'resigned' or g.winner <> 'e0000000-0000-0000-0000-0000000000a1' or g.next_player is not null then raise exception 'resign wrong'; end if;
  -- 结束后：不能再走、不能再认输
  begin perform public.ttt_move(gid, 8); raise exception 'move after resign should fail';
  exception when others then if sqlerrm <> 'game_over' then raise; end if; end;
  begin perform public.ttt_resign(gid); raise exception 'resign after resign should fail';
  exception when others then if sqlerrm <> 'game_over' then raise; end if; end;
end $$;

-- 8 条胜线：X 走满一条线，O 走线外的两格；检查状态、赢家、win_line；之后不能再走
-- 每局都由 alice（X）重新开（上一局已结束，所以会新建）
do $$
declare
  lines int[] := array[0,1,2, 3,4,5, 6,7,8, 0,3,6, 1,4,7, 2,5,8, 0,4,8, 2,4,6];
  l int[]; others int[]; gid bigint; g public.ttt_games; i int; c int; k int;
  prev bigint := 0;
begin
  for i in 0..7 loop
    l := lines[i * 3 + 1 : i * 3 + 3];
    others := array[]::int[];
    for c in 0..8 loop
      if not (c = any (l)) and coalesce(array_length(others, 1), 0) < 2 then others := others || c; end if;
    end loop;
    call pg_temp.as_user('e0000000-0000-0000-0000-0000000000a1');
    g := public.ttt_start('e0000000-0000-0000-0000-0000000000b1');
    if g.id <= prev then raise exception 'rematch should create a new game'; end if;
    prev := g.id; gid := g.id;
    for k in 1..3 loop
      call pg_temp.as_user('e0000000-0000-0000-0000-0000000000a1');
      g := public.ttt_move(gid, l[k]);
      if k < 3 then
        call pg_temp.as_user('e0000000-0000-0000-0000-0000000000b1');
        g := public.ttt_move(gid, others[k]);
      end if;
    end loop;
    if g.status <> 'x_won' or g.winner <> 'e0000000-0000-0000-0000-0000000000a1' or g.next_player is not null
       or g.win_line <> l[1] || ',' || l[2] || ',' || l[3] then
      raise exception 'line % wrong: % % %', i, g.status, g.winner, g.win_line; end if;
    begin perform public.ttt_move(gid, others[1]); raise exception 'move after win should fail';
    exception when others then if sqlerrm <> 'game_over' then raise; end if; end;
  end loop;
end $$;

-- O 也能赢：bob 先发起（bob 为 X），alice 作为 O 走 0,1,2 赢
do $$
declare g public.ttt_games; gid bigint;
begin
  call pg_temp.as_user('e0000000-0000-0000-0000-0000000000b1');
  g := public.ttt_start('e0000000-0000-0000-0000-0000000000a1');
  if g.player_x <> 'e0000000-0000-0000-0000-0000000000b1' then raise exception 'bob should be X on his own start'; end if;
  gid := g.id;
  perform public.ttt_move(gid, 3);
  call pg_temp.as_user('e0000000-0000-0000-0000-0000000000a1');
  perform public.ttt_move(gid, 0);
  call pg_temp.as_user('e0000000-0000-0000-0000-0000000000b1');
  perform public.ttt_move(gid, 4);
  call pg_temp.as_user('e0000000-0000-0000-0000-0000000000a1');
  perform public.ttt_move(gid, 1);
  call pg_temp.as_user('e0000000-0000-0000-0000-0000000000b1');
  perform public.ttt_move(gid, 8);
  call pg_temp.as_user('e0000000-0000-0000-0000-0000000000a1');
  g := public.ttt_move(gid, 2);
  if g.status <> 'o_won' or g.winner <> 'e0000000-0000-0000-0000-0000000000a1' or g.win_line <> '0,1,2' then raise exception 'o win wrong: % %', g.status, g.win_line; end if;
end $$;

-- 平局：x o x / x o o / o x x（最后一步不成线）
do $$
declare g public.ttt_games; gid bigint; mv int[] := array[0,1,2,4,3,5,7,6,8]; k int;
begin
  call pg_temp.as_user('e0000000-0000-0000-0000-0000000000a1');
  g := public.ttt_start('e0000000-0000-0000-0000-0000000000b1');
  gid := g.id;
  for k in 1..9 loop
    if k % 2 = 1 then call pg_temp.as_user('e0000000-0000-0000-0000-0000000000a1'); else call pg_temp.as_user('e0000000-0000-0000-0000-0000000000b1'); end if;
    g := public.ttt_move(gid, mv[k]);
  end loop;
  if g.status <> 'draw' or g.winner is not null or g.win_line is not null or g.next_player is not null then
    raise exception 'draw wrong: % %', g.status, g.board; end if;
  if position('.' in g.board) <> 0 then raise exception 'board should be full'; end if;
  begin perform public.ttt_move(gid, 0); raise exception 'move after draw should fail';
  exception when others then if sqlerrm <> 'game_over' then raise; end if; end;
end $$;

-- 认输的另一方向：X 在自己的回合之外也能认输
do $$
declare g public.ttt_games;
begin
  call pg_temp.as_user('e0000000-0000-0000-0000-0000000000a1');
  g := public.ttt_start('e0000000-0000-0000-0000-0000000000b1');
  call pg_temp.as_user('e0000000-0000-0000-0000-0000000000b1');
  g := public.ttt_resign(g.id);
  if g.status <> 'resigned' or g.winner <> 'e0000000-0000-0000-0000-0000000000a1' then raise exception 'O resigning on X turn wrong'; end if;
end $$;

-- 清理
reset role;
delete from auth.users where email like '%@ttt-test.local';
do $$ begin
  if exists (select 1 from public.ttt_games g join public.profiles p on p.id in (g.player_x, g.player_o) where p.username like 'ttt\_%') then
    raise exception 'cleanup failed'; end if;
end $$;

select 'all tic-tac-toe tests passed';
