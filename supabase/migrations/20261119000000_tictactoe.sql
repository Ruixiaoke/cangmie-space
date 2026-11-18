-- 聊天小程序：井字棋（双人实时对战，聊天里"+"面板的第一个工具）
-- 由 GitHub Actions（.github/workflows/backend.yml）自动执行；可重复运行
--
-- 对局存在 ttt_games，只能通过三个函数改（没有写策略）：
--   ttt_start(对方)    开一局（已有进行中的就直接返回），并在聊天里发一条 [井字棋]#id 的消息
--   ttt_move(局, 格子) 落子，自动判胜负
--   ttt_resign(局)     认输
-- 再来一局就是对局结束后再调一次 ttt_start（发起人执 X 先手）。

create table if not exists public.ttt_games (
  id           bigint generated always as identity primary key,
  player_x     uuid not null references public.profiles (id) on delete cascade,
  player_o     uuid not null references public.profiles (id) on delete cascade,
  board        text not null default '.........'
               constraint ttt_games_board_valid check (board ~ '^[.xo]{9}$'),
  next_player  uuid,
  status       text not null default 'active'
               constraint ttt_games_status_valid check (status in ('active', 'x_won', 'o_won', 'draw', 'resigned')),
  winner       uuid,
  win_line     text,
  message_id   bigint references public.messages (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint ttt_games_distinct_players check (player_x <> player_o)
);

create index if not exists ttt_games_x_idx on public.ttt_games (player_x, player_o, id desc);
create index if not exists ttt_games_o_idx on public.ttt_games (player_o, player_x, id desc);
create index if not exists ttt_games_message_idx on public.ttt_games (message_id) where message_id is not null;

alter table public.ttt_games enable row level security;

revoke all on table public.ttt_games from public, anon, authenticated;
grant select on table public.ttt_games to authenticated;

drop policy if exists ttt_games_select_players on public.ttt_games;
create policy ttt_games_select_players on public.ttt_games
  for select to authenticated
  using (auth.uid() = player_x or auth.uid() = player_o);

-- 开一局
create or replace function public.ttt_start(p_peer uuid)
returns public.ttt_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := auth.uid();
  v_game public.ttt_games;
  v_msg  public.messages;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if p_peer is null or p_peer = v_me or not exists (
    select 1 from public.friendships f
    where f.status = 'accepted'
      and least(f.requester_id, f.addressee_id) = least(v_me, p_peer)
      and greatest(f.requester_id, f.addressee_id) = greatest(v_me, p_peer)
  ) then
    raise exception 'not_friends';
  end if;

  -- 同一对好友同一时间只有一局：串行化，免得两边同时点出两局
  perform pg_advisory_xact_lock(hashtextextended(least(v_me, p_peer)::text || greatest(v_me, p_peer)::text, 0));

  select * into v_game from public.ttt_games g
  where g.status = 'active'
    and least(g.player_x, g.player_o) = least(v_me, p_peer)
    and greatest(g.player_x, g.player_o) = greatest(v_me, p_peer)
  order by g.id desc
  limit 1;
  if found then
    return v_game;
  end if;

  insert into public.ttt_games (player_x, player_o, next_player)
  values (v_me, p_peer, v_me)
  returning * into v_game;

  insert into public.messages (sender_id, receiver_id, body)
  values (v_me, p_peer, '[井字棋]#' || v_game.id)
  returning * into v_msg;

  update public.ttt_games set message_id = v_msg.id where id = v_game.id
  returning * into v_game;
  return v_game;
end;
$$;

-- 落子
create or replace function public.ttt_move(p_game bigint, p_cell int)
returns public.ttt_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_game  public.ttt_games;
  v_mark  text;
  v_board text;
  v_line  int[];
  v_lines int[] := array[0,1,2, 3,4,5, 6,7,8, 0,3,6, 1,4,7, 2,5,8, 0,4,8, 2,4,6];
  i       int;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_game from public.ttt_games g
  where g.id = p_game and (g.player_x = v_me or g.player_o = v_me)
  for update;
  if not found then
    raise exception 'game_not_found';
  end if;
  if v_game.status <> 'active' then
    raise exception 'game_over';
  end if;
  if p_cell is null or p_cell < 0 or p_cell > 8 then
    raise exception 'invalid_cell';
  end if;
  if v_game.next_player is distinct from v_me then
    raise exception 'not_your_turn';
  end if;
  if substr(v_game.board, p_cell + 1, 1) <> '.' then
    raise exception 'cell_taken';
  end if;

  v_mark  := case when v_me = v_game.player_x then 'x' else 'o' end;
  v_board := overlay(v_game.board placing v_mark from p_cell + 1 for 1);

  for i in 0..7 loop
    v_line := v_lines[i * 3 + 1 : i * 3 + 3];
    if substr(v_board, v_line[1] + 1, 1) = v_mark
       and substr(v_board, v_line[2] + 1, 1) = v_mark
       and substr(v_board, v_line[3] + 1, 1) = v_mark then
      update public.ttt_games
      set board = v_board,
          status = case when v_mark = 'x' then 'x_won' else 'o_won' end,
          winner = v_me,
          win_line = v_line[1] || ',' || v_line[2] || ',' || v_line[3],
          next_player = null,
          updated_at = now()
      where id = v_game.id
      returning * into v_game;
      return v_game;
    end if;
  end loop;

  if position('.' in v_board) = 0 then
    update public.ttt_games
    set board = v_board, status = 'draw', next_player = null, updated_at = now()
    where id = v_game.id
    returning * into v_game;
  else
    update public.ttt_games
    set board = v_board,
        next_player = case when v_me = player_x then player_o else player_x end,
        updated_at = now()
    where id = v_game.id
    returning * into v_game;
  end if;
  return v_game;
end;
$$;

-- 认输：对方获胜
create or replace function public.ttt_resign(p_game bigint)
returns public.ttt_games
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := auth.uid();
  v_game public.ttt_games;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  select * into v_game from public.ttt_games g
  where g.id = p_game and (g.player_x = v_me or g.player_o = v_me)
  for update;
  if not found then
    raise exception 'game_not_found';
  end if;
  if v_game.status <> 'active' then
    raise exception 'game_over';
  end if;

  update public.ttt_games
  set status = 'resigned',
      winner = case when v_me = player_x then player_o else player_x end,
      next_player = null,
      updated_at = now()
  where id = v_game.id
  returning * into v_game;
  return v_game;
end;
$$;

revoke execute on function public.ttt_start(uuid) from public, anon;
revoke execute on function public.ttt_move(bigint, int) from public, anon;
revoke execute on function public.ttt_resign(bigint) from public, anon;
grant execute on function public.ttt_start(uuid) to authenticated;
grant execute on function public.ttt_move(bigint, int) to authenticated;
grant execute on function public.ttt_resign(bigint) to authenticated;

-- Realtime：对局变化实时推给双方
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ttt_games'
    ) then
      alter publication supabase_realtime add table public.ttt_games;
    end if;
  else
    raise notice 'publication supabase_realtime 不存在，跳过 Realtime 配置';
  end if;
end $$;
