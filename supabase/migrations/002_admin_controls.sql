begin;

alter table public.profiles
  add column if not exists status text not null default 'active',
  add column if not exists status_reason text,
  add column if not exists note text;

alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles
  add constraint profiles_status_check check (status in ('active', 'suspended'));

create table if not exists public.announcements (
  id integer primary key,
  title text not null default '',
  body text not null default '',
  active boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint announcements_singleton check (id = 1)
);

insert into public.announcements (id)
values (1)
on conflict (id) do nothing;

alter table public.announcements enable row level security;
drop policy if exists "Anyone reads notices" on public.announcements;
create policy "Anyone reads notices"
on public.announcements
for select
to anon, authenticated
using (true);
revoke all on table public.announcements from public, anon, authenticated;
grant select on table public.announcements to anon, authenticated;

create table if not exists public.admin_audit (
  id bigint generated always as identity primary key,
  actor_email text not null,
  action text not null,
  target_email text,
  detail text,
  created_at timestamptz not null default now()
);

alter table public.admin_audit enable row level security;
drop policy if exists "Admins read audit" on public.admin_audit;
create policy "Admins read audit"
on public.admin_audit
for select
to authenticated
using ((select public.is_admin()));
revoke all on table public.admin_audit from public, anon, authenticated;
grant select on table public.admin_audit to authenticated;

create or replace function private.admin_actor_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function private.assert_admin()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;
end;
$$;

create or replace function private.write_audit(action text, target_email text, detail text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.admin_audit (actor_email, action, target_email, detail)
  values (private.admin_actor_email(), action, target_email, detail);
end;
$$;

create or replace function public.admin_desk()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  perform private.assert_admin();
  select jsonb_build_object(
    'users', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.created_at desc)
      from public.profiles as p
    ), '[]'::jsonb),
    'admins', coalesce((
      select jsonb_agg(a.email order by a.email)
      from private.admin_users as a
    ), '[]'::jsonb),
    'announcement', coalesce((
      select to_jsonb(n) from public.announcements as n where n.id = 1
    ), '{}'::jsonb),
    'audit', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.created_at desc)
      from (
        select id, actor_email, action, target_email, detail, created_at
        from public.admin_audit
        order by created_at desc
        limit 50
      ) as e
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.admin_set_status(target_id uuid, next_status text, reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_email text;
begin
  perform private.assert_admin();
  if next_status not in ('active', 'suspended') then
    raise exception 'Unknown status';
  end if;
  if target_id = auth.uid() and next_status = 'suspended' then
    raise exception 'You cannot suspend your own account';
  end if;
  select email into target_email from public.profiles where id = target_id;
  if target_email is null then
    raise exception 'User not found';
  end if;
  update public.profiles
  set status = next_status,
      status_reason = nullif(trim(coalesce(reason, '')), '')
  where id = target_id;
  if next_status = 'suspended' then
    delete from auth.sessions where user_id = target_id;
  end if;
  perform private.write_audit(
    case when next_status = 'suspended' then 'suspend' else 'restore' end,
    target_email,
    nullif(trim(coalesce(reason, '')), '')
  );
end;
$$;

create or replace function public.admin_set_note(target_id uuid, next_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_email text;
begin
  perform private.assert_admin();
  select email into target_email from public.profiles where id = target_id;
  if target_email is null then
    raise exception 'User not found';
  end if;
  update public.profiles
  set note = nullif(trim(coalesce(next_note, '')), '')
  where id = target_id;
  perform private.write_audit('note', target_email, nullif(trim(coalesce(next_note, '')), ''));
end;
$$;

create or replace function public.admin_remove_user(target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_email text;
begin
  perform private.assert_admin();
  if target_id = auth.uid() then
    raise exception 'You cannot remove your own account';
  end if;
  select email into target_email from public.profiles where id = target_id;
  if target_email is null then
    raise exception 'User not found';
  end if;
  if target_email = 'az.i.zisnotme@gmail.com' then
    raise exception 'The owner account cannot be removed';
  end if;
  perform private.write_audit('remove-user', target_email, null);
  delete from auth.users where id = target_id;
end;
$$;

create or replace function public.admin_grant(target_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized text := lower(trim(coalesce(target_email, '')));
begin
  perform private.assert_admin();
  if normalized !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a full email address';
  end if;
  insert into private.admin_users (email) values (normalized) on conflict (email) do nothing;
  perform private.write_audit('grant-admin', normalized, null);
end;
$$;

create or replace function public.admin_revoke(target_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized text := lower(trim(coalesce(target_email, '')));
begin
  perform private.assert_admin();
  if normalized = 'az.i.zisnotme@gmail.com' then
    raise exception 'The owner stays an admin';
  end if;
  if normalized = private.admin_actor_email() then
    raise exception 'You cannot remove your own admin access';
  end if;
  delete from private.admin_users where email = normalized;
  perform private.write_audit('revoke-admin', normalized, null);
end;
$$;

create or replace function public.admin_publish_notice(next_title text, next_body text, is_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin();
  update public.announcements
  set title = trim(coalesce(next_title, '')),
      body = trim(coalesce(next_body, '')),
      active = coalesce(is_active, false),
      updated_at = now()
  where id = 1;
  perform private.write_audit('notice', null, case when coalesce(is_active, false) then 'published' else 'hidden' end);
end;
$$;

create or replace function public.admin_clear_audit()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin();
  delete from public.admin_audit;
end;
$$;

revoke all on function public.admin_desk() from public, anon;
revoke all on function public.admin_set_status(uuid, text, text) from public, anon;
revoke all on function public.admin_set_note(uuid, text) from public, anon;
revoke all on function public.admin_remove_user(uuid) from public, anon;
revoke all on function public.admin_grant(text) from public, anon;
revoke all on function public.admin_revoke(text) from public, anon;
revoke all on function public.admin_publish_notice(text, text, boolean) from public, anon;
revoke all on function public.admin_clear_audit() from public, anon;

grant execute on function public.admin_desk() to authenticated;
grant execute on function public.admin_set_status(uuid, text, text) to authenticated;
grant execute on function public.admin_set_note(uuid, text) to authenticated;
grant execute on function public.admin_remove_user(uuid) to authenticated;
grant execute on function public.admin_grant(text) to authenticated;
grant execute on function public.admin_revoke(text) to authenticated;
grant execute on function public.admin_publish_notice(text, text, boolean) to authenticated;
grant execute on function public.admin_clear_audit() to authenticated;

commit;
