begin;

alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles
  add constraint profiles_status_check check (status in ('active', 'suspended', 'banned'));

create table if not exists public.known_devices (
  device_id text primary key,
  user_id uuid,
  email text,
  last_seen timestamptz not null default now()
);

alter table public.known_devices enable row level security;
revoke all on table public.known_devices from public, anon, authenticated;

create table if not exists public.bans (
  id bigint generated always as identity primary key,
  email text,
  device_id text,
  reason text,
  created_at timestamptz not null default now()
);

create unique index if not exists bans_email_key on public.bans (email) where email is not null and device_id is null;
create unique index if not exists bans_device_key on public.bans (device_id) where device_id is not null;

alter table public.bans enable row level security;
revoke all on table public.bans from public, anon, authenticated;

create or replace function public.app_lock(device_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  normalized_device text := nullif(trim(coalesce(device_id, '')), '');
  account_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  reason text;
begin
  if public.is_admin() then
    return jsonb_build_object('banned', false, 'reason', null);
  end if;

  if normalized_device is not null then
    select b.reason into reason
    from public.bans as b
    where b.device_id = normalized_device
    limit 1;
    if found then
      return jsonb_build_object('banned', true, 'reason', coalesce(reason, 'This computer is banned from Scribble.'));
    end if;
  end if;

  if account_email <> '' then
    if account_email = 'az.i.zisnotme@gmail.com' then
      return jsonb_build_object('banned', false, 'reason', null);
    end if;
    select b.reason into reason from public.bans as b where b.email = account_email limit 1;
    if found then
      return jsonb_build_object('banned', true, 'reason', coalesce(reason, 'This account is banned from Scribble.'));
    end if;
    if exists (select 1 from public.blocked_emails as e where e.email = account_email) then
      return jsonb_build_object('banned', true, 'reason', 'This account is banned from Scribble.');
    end if;
    if exists (select 1 from public.profiles as p where p.email = account_email and p.status = 'banned') then
      return jsonb_build_object('banned', true, 'reason', 'This account is banned from Scribble.');
    end if;
  end if;

  return jsonb_build_object('banned', false, 'reason', null);
end;
$$;

create or replace function public.register_device(device_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized text := nullif(trim(coalesce(device_id, '')), '');
  account_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if auth.uid() is null or normalized is null then
    return;
  end if;
  insert into public.known_devices (device_id, user_id, email, last_seen)
  values (normalized, auth.uid(), account_email, now())
  on conflict (device_id) do update
  set user_id = excluded.user_id,
      email = excluded.email,
      last_seen = now();
end;
$$;

create or replace function public.admin_ban(target_id uuid, reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_email text;
  cleaned text := nullif(trim(coalesce(reason, '')), '');
begin
  perform private.assert_admin();
  select email into target_email from public.profiles where id = target_id;
  if target_email is null then
    raise exception 'User not found';
  end if;
  if target_email = 'az.i.zisnotme@gmail.com' then
    raise exception 'The owner account cannot be banned';
  end if;
  update public.profiles
  set status = 'banned',
      status_reason = cleaned
  where id = target_id;
  update public.bans set reason = cleaned where email = target_email and device_id is null;
  if not found then
    insert into public.bans (email, reason) values (target_email, cleaned);
  end if;
  insert into public.bans (device_id, email, reason)
  select d.device_id, target_email, cleaned
  from public.known_devices as d
  where (d.user_id = target_id or d.email = target_email)
    and not exists (select 1 from public.bans as existing where existing.device_id = d.device_id);
  update public.bans as b
  set reason = cleaned, email = target_email
  where b.device_id in (
    select d.device_id from public.known_devices as d
    where d.user_id = target_id or d.email = target_email
  );
  insert into public.blocked_emails (email, reason)
  values (target_email, cleaned)
  on conflict (email) do update set reason = excluded.reason;
  delete from auth.sessions where user_id = target_id;
  perform private.write_audit('ban', target_email, cleaned);
end;
$$;

create or replace function public.admin_unban(target_id uuid)
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
  set status = 'active',
      status_reason = null
  where id = target_id;
  delete from public.bans where email = target_email;
  delete from public.blocked_emails where email = target_email;
  perform private.write_audit('unban', target_email, null);
end;
$$;

revoke all on function public.app_lock(text) from public;
revoke all on function public.register_device(text) from public, anon;
revoke all on function public.admin_ban(uuid, text) from public, anon;
revoke all on function public.admin_unban(uuid) from public, anon;

grant execute on function public.app_lock(text) to anon, authenticated;
grant execute on function public.register_device(text) to authenticated;
grant execute on function public.admin_ban(uuid, text) to authenticated;
grant execute on function public.admin_unban(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
