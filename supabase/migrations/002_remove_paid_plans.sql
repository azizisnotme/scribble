begin;

drop function if exists public.set_user_plan(uuid, text);
alter table if exists public.profiles drop column if exists plan;

commit;

