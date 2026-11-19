-- jx3_calendar：用户（anon / authenticated）读不到也写不进
begin;
insert into public.jx3_calendar (date, data) values ('2026-11-19', '{"war":"大战！英雄大阳津"}');
set local role authenticated;
do $$
begin
  begin
    perform 1 from public.jx3_calendar;
    raise exception 'authenticated should not read jx3_calendar';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.jx3_calendar (date, data) values ('2026-11-20', '{}');
    raise exception 'authenticated should not write jx3_calendar';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select 'jx3 calendar tests ok';
rollback;
