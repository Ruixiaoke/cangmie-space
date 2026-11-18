-- 云端默认不一定给后端角色新表的读取权限，本地裸 Postgres 则可能没有该角色。
do $$
declare
  v_role text := 'service' || '_role';
begin
  if exists (select 1 from pg_roles where rolname = v_role) then
    execute format(
      'grant select on table public.friendships, public.profiles, public.ttt_games,
       public.pool_games, public.pool_shots, public.sling_games, public.sling_shots to %I',
      v_role
    );
  end if;
end $$;
