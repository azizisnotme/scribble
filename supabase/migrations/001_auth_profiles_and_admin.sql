begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.admin_users (
  email text primary key check (email = lower(trim(email))),
  created_at timestamptz not null default now()
);

insert into private.admin_users (email)
values ('az.i.zisnotme@gmail.com')
on conflict (email) do nothing;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz
);

alter table public.profiles enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '') = 'google'
    and coalesce((auth.jwt() -> 'user_metadata' ->> 'email_verified')::boolean, false)
    and exists (
      select 1
      from private.admin_users as admins
      where admins.email = lower(coalesce(auth.jwt() ->> 'email', ''))
    );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create or replace function private.sync_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (
    id,
    email,
    display_name,
    avatar_url,
    created_at,
    last_sign_in_at
  )
  values (
    new.id,
    lower(coalesce(new.email, '')),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture'),
    coalesce(new.created_at, now()),
    new.last_sign_in_at
  )
  on conflict (id) do update
  set
    email = excluded.email,
    display_name = excluded.display_name,
    avatar_url = excluded.avatar_url,
    last_sign_in_at = excluded.last_sign_in_at;

  return new;
end;
$$;

drop trigger if exists sync_auth_user_profile on auth.users;
create trigger sync_auth_user_profile
after insert or update of email, raw_user_meta_data, last_sign_in_at
on auth.users
for each row execute function private.sync_auth_user_profile();

insert into public.profiles (id, email, display_name, avatar_url, created_at, last_sign_in_at)
select
  users.id,
  lower(coalesce(users.email, '')),
  coalesce(users.raw_user_meta_data ->> 'full_name', users.raw_user_meta_data ->> 'name'),
  coalesce(users.raw_user_meta_data ->> 'avatar_url', users.raw_user_meta_data ->> 'picture'),
  users.created_at,
  users.last_sign_in_at
from auth.users as users
on conflict (id) do update
set
  email = excluded.email,
  display_name = excluded.display_name,
  avatar_url = excluded.avatar_url,
  last_sign_in_at = excluded.last_sign_in_at;

drop policy if exists "Users read their own profile" on public.profiles;
create policy "Users read their own profile"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "Admins read all profiles" on public.profiles;
create policy "Admins read all profiles"
on public.profiles
for select
to authenticated
using ((select public.is_admin()));

revoke all on table public.profiles from public, anon, authenticated;
grant select on table public.profiles to authenticated;

commit;

