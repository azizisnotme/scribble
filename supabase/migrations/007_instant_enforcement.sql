create table if not exists public.app_pulse (
  id integer primary key,
  seq bigint not null default 1,
  updated_at timestamptz not null default now(),
  constraint app_pulse_singleton check (id = 1)
);

insert into public.app_pulse (id)
values (1)
on conflict (id) do nothing;

alter table public.app_pulse replica identity full;
alter table public.app_pulse enable row level security;

drop policy if exists "Anyone reads app pulse" on public.app_pulse;
create policy "Anyone reads app pulse"
on public.app_pulse
for select
to anon, authenticated
using (true);

revoke all on table public.app_pulse from public, anon, authenticated;
grant select on table public.app_pulse to anon, authenticated;

create or replace function private.bump_app_pulse()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.app_pulse
  set seq = seq + 1,
      updated_at = now()
  where id = 1;
  return null;
end;
$$;

drop trigger if exists app_pulse_on_audit on public.admin_audit;
create trigger app_pulse_on_audit
after insert on public.admin_audit
for each statement
execute function private.bump_app_pulse();

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'app_pulse'
  ) then
    alter publication supabase_realtime add table public.app_pulse;
  end if;
end $$;

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
  if account_email = 'az.i.zisnotme@gmail.com' then
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
    select b.reason into reason from public.bans as b where b.email = account_email limit 1;
    if found then
      return jsonb_build_object('banned', true, 'reason', coalesce(reason, 'This account is banned from Scribble.'));
    end if;
    if exists (select 1 from public.blocked_emails as e where e.email = account_email) then
      return jsonb_build_object('banned', true, 'reason', 'This account is banned from Scribble.');
    end if;
    if exists (select 1 from public.profiles as p where lower(p.email) = account_email and p.status = 'banned') then
      return jsonb_build_object('banned', true, 'reason', 'This account is banned from Scribble.');
    end if;
  end if;

  return jsonb_build_object('banned', false, 'reason', null);
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
  select lower(email) into target_email from public.profiles where id = target_id;
  if target_email is null then
    raise exception 'User not found';
  end if;
  if target_email = 'az.i.zisnotme@gmail.com' then
    raise exception 'The owner account cannot be banned';
  end if;
  delete from private.admin_users where email = target_email;
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
  where (d.user_id = target_id or lower(d.email) = target_email)
    and not exists (select 1 from public.bans as existing where existing.device_id = d.device_id);
  update public.bans as b
  set reason = cleaned, email = target_email
  where b.device_id in (
    select d.device_id from public.known_devices as d
    where d.user_id = target_id or lower(d.email) = target_email
  );
  insert into public.blocked_emails (email, reason)
  values (target_email, cleaned)
  on conflict (email) do update set reason = excluded.reason;
  delete from auth.sessions where user_id = target_id;
  perform private.write_audit('ban', target_email, cleaned);
end;
$$;

notify pgrst, 'reload schema';
