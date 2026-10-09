begin;

alter table public.announcements
  add column if not exists tone text not null default 'info';

alter table public.announcements drop constraint if exists announcements_tone_check;
alter table public.announcements
  add constraint announcements_tone_check check (tone in ('info', 'warning'));

create table if not exists public.app_controls (
  id integer primary key,
  signups_open boolean not null default true,
  signups_closed_at timestamptz,
  maintenance_on boolean not null default false,
  maintenance_message text not null default '',
  updated_at timestamptz not null default now(),
  constraint app_controls_singleton check (id = 1)
);

insert into public.app_controls (id)
values (1)
on conflict (id) do nothing;

alter table public.app_controls enable row level security;
drop policy if exists "Anyone reads app controls" on public.app_controls;
create policy "Anyone reads app controls"
on public.app_controls
for select
to anon, authenticated
using (true);
revoke all on table public.app_controls from public, anon, authenticated;
grant select on table public.app_controls to anon, authenticated;

create table if not exists public.blocked_emails (
  email text primary key check (email = lower(trim(email))),
  reason text,
  created_at timestamptz not null default now()
);

alter table public.blocked_emails enable row level security;
revoke all on table public.blocked_emails from public, anon, authenticated;

create or replace function public.account_standing()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  account_email text;
  created timestamptz;
  controls public.app_controls%rowtype;
  block_reason text;
  admin_account boolean := false;
begin
  select * into controls from public.app_controls where id = 1;
  if uid is null then
    return jsonb_build_object(
      'blocked', false,
      'signup_rejected', false,
      'signups_open', coalesce(controls.signups_open, true),
      'maintenance_on', coalesce(controls.maintenance_on, false),
      'maintenance_message', coalesce(controls.maintenance_message, '')
    );
  end if;

  select p.email, p.created_at into account_email, created
  from public.profiles as p
  where p.id = uid;
  account_email := lower(coalesce(account_email, auth.jwt() ->> 'email', ''));
  select b.reason into block_reason from public.blocked_emails as b where b.email = account_email;
  admin_account := public.is_admin();

  return jsonb_build_object(
    'blocked', block_reason is not null and not admin_account,
    'block_reason', block_reason,
    'signup_rejected',
      not admin_account
      and coalesce(controls.signups_open, true) = false
      and controls.signups_closed_at is not null
      and created is not null
      and created > controls.signups_closed_at,
    'signups_open', coalesce(controls.signups_open, true),
    'maintenance_on', coalesce(controls.maintenance_on, false),
    'maintenance_message', coalesce(controls.maintenance_message, '')
  );
end;
$$;

revoke all on function public.account_standing() from public;
grant execute on function public.account_standing() to anon, authenticated;

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
    'controls', coalesce((
      select to_jsonb(c) from public.app_controls as c where c.id = 1
    ), '{}'::jsonb),
    'blocked', coalesce((
      select jsonb_agg(jsonb_build_object('email', b.email, 'reason', b.reason, 'created_at', b.created_at) order by b.created_at desc)
      from public.blocked_emails as b
    ), '[]'::jsonb),
    'audit', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.created_at desc)
      from (
        select id, actor_email, action, target_email, detail, created_at
        from public.admin_audit
        order by created_at desc
        limit 80
      ) as e
    ), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

create or replace function public.admin_save_notice(next_title text, next_body text, is_active boolean, next_tone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  chosen_tone text := case when next_tone = 'warning' then 'warning' else 'info' end;
begin
  perform private.assert_admin();
  update public.announcements
  set title = trim(coalesce(next_title, '')),
      body = trim(coalesce(next_body, '')),
      active = coalesce(is_active, false),
      tone = chosen_tone,
      updated_at = now()
  where id = 1;
  perform private.write_audit('notice', null, chosen_tone || case when coalesce(is_active, false) then ' shown' else ' hidden' end);
end;
$$;

create or replace function public.admin_set_controls(next_signups_open boolean, next_maintenance_on boolean, next_maintenance_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin();
  update public.app_controls
  set signups_open = coalesce(next_signups_open, true),
      signups_closed_at = case
        when coalesce(next_signups_open, true) then null
        else coalesce(signups_closed_at, now())
      end,
      maintenance_on = coalesce(next_maintenance_on, false),
      maintenance_message = trim(coalesce(next_maintenance_message, '')),
      updated_at = now()
  where id = 1;
  perform private.write_audit(
    'controls',
    null,
    case when coalesce(next_signups_open, true) then 'signups open' else 'signups closed' end
      || case when coalesce(next_maintenance_on, false) then ', maintenance on' else ', maintenance off' end
  );
end;
$$;

create or replace function public.admin_block_email(target_email text, reason text)
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
    raise exception 'The owner account cannot be blocked';
  end if;
  if normalized !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a full email address';
  end if;
  insert into public.blocked_emails (email, reason)
  values (normalized, nullif(trim(coalesce(reason, '')), ''))
  on conflict (email) do update set reason = excluded.reason;
  delete from auth.sessions
  where user_id in (select id from public.profiles where email = normalized);
  perform private.write_audit('block', normalized, nullif(trim(coalesce(reason, '')), ''));
end;
$$;

create or replace function public.admin_unblock_email(target_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized text := lower(trim(coalesce(target_email, '')));
begin
  perform private.assert_admin();
  delete from public.blocked_emails where email = normalized;
  perform private.write_audit('unblock', normalized, null);
end;
$$;

create or replace function public.admin_sign_out(target_id uuid)
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
  delete from auth.sessions where user_id = target_id;
  perform private.write_audit('sign-out', target_email, null);
end;
$$;

create or replace function public.admin_sign_out_others()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_admin();
  delete from auth.sessions where user_id is distinct from auth.uid();
  perform private.write_audit('sign-out-all', null, 'everyone except you');
end;
$$;

create or replace function public.admin_restore_all()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  restored integer;
begin
  perform private.assert_admin();
  update public.profiles
  set status = 'active', status_reason = null
  where status = 'suspended';
  get diagnostics restored = row_count;
  perform private.write_audit('restore-all', null, restored::text || ' accounts');
end;
$$;

create or replace function public.admin_rename(target_id uuid, next_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_email text;
  cleaned text := nullif(trim(coalesce(next_name, '')), '');
begin
  perform private.assert_admin();
  select email into target_email from public.profiles where id = target_id;
  if target_email is null then
    raise exception 'User not found';
  end if;
  update public.profiles set display_name = cleaned where id = target_id;
  perform private.write_audit('rename', target_email, cleaned);
end;
$$;

revoke all on function public.admin_save_notice(text, text, boolean, text) from public, anon;
revoke all on function public.admin_set_controls(boolean, boolean, text) from public, anon;
revoke all on function public.admin_block_email(text, text) from public, anon;
revoke all on function public.admin_unblock_email(text) from public, anon;
revoke all on function public.admin_sign_out(uuid) from public, anon;
revoke all on function public.admin_sign_out_others() from public, anon;
revoke all on function public.admin_restore_all() from public, anon;
revoke all on function public.admin_rename(uuid, text) from public, anon;

grant execute on function public.admin_save_notice(text, text, boolean, text) to authenticated;
grant execute on function public.admin_set_controls(boolean, boolean, text) to authenticated;
grant execute on function public.admin_block_email(text, text) to authenticated;
grant execute on function public.admin_unblock_email(text) to authenticated;
grant execute on function public.admin_sign_out(uuid) to authenticated;
grant execute on function public.admin_sign_out_others() to authenticated;
grant execute on function public.admin_restore_all() to authenticated;
grant execute on function public.admin_rename(uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;
