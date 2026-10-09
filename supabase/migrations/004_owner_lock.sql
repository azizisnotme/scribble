begin;

insert into private.admin_users (email)
values ('az.i.zisnotme@gmail.com')
on conflict (email) do nothing;

delete from public.blocked_emails where email = 'az.i.zisnotme@gmail.com';

update public.profiles
set status = 'active', status_reason = null
where email = 'az.i.zisnotme@gmail.com' and status = 'suspended';

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
    and (
      lower(coalesce(auth.jwt() ->> 'email', '')) = 'az.i.zisnotme@gmail.com'
      or exists (
        select 1
        from private.admin_users as admins
        where admins.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
    );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

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
  if target_email = 'az.i.zisnotme@gmail.com' and next_status = 'suspended' then
    raise exception 'The owner account cannot be suspended';
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
  if target_email = 'az.i.zisnotme@gmail.com' then
    raise exception 'The owner account cannot be signed out';
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
  delete from auth.sessions
  where user_id is distinct from auth.uid()
    and user_id not in (
      select id from public.profiles where email = 'az.i.zisnotme@gmail.com'
    );
  perform private.write_audit('sign-out-all', null, 'everyone except the owner');
end;
$$;

commit;
