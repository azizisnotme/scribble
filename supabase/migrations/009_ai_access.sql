begin;

alter table public.profiles
  add column if not exists ai_unlimited boolean not null default false,
  add column if not exists ai_daily_limit integer check (ai_daily_limit is null or ai_daily_limit >= 0);

alter table public.app_controls
  add column if not exists ai_daily_limit integer not null default 25 check (ai_daily_limit >= 0);

create table if not exists private.ai_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  used integer not null default 0,
  primary key (user_id, day)
);

create or replace function private.is_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() and lower(coalesce(auth.jwt() ->> 'email', '')) = 'az.i.zisnotme@gmail.com';
$$;

create or replace function public.ai_quota()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'utc')::date;
  account public.profiles%rowtype;
  owner_account boolean;
  daily integer;
  used_today integer;
begin
  if uid is null then
    raise exception 'Sign in to use Scribble AI';
  end if;
  select * into account from public.profiles where id = uid;
  owner_account := private.is_owner();
  if owner_account or coalesce(account.ai_unlimited, false) then
    return jsonb_build_object('unlimited', true, 'owner', owner_account, 'limit', null, 'used', 0, 'remaining', null, 'resets_at', null);
  end if;
  daily := coalesce(account.ai_daily_limit, (select c.ai_daily_limit from public.app_controls as c where c.id = 1), 25);
  select u.used into used_today from private.ai_usage as u where u.user_id = uid and u.day = today;
  used_today := coalesce(used_today, 0);
  return jsonb_build_object(
    'unlimited', false,
    'owner', false,
    'limit', daily,
    'used', used_today,
    'remaining', greatest(daily - used_today, 0),
    'resets_at', (today + 1)::timestamp at time zone 'utc'
  );
end;
$$;

create or replace function public.consume_ai_use()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'utc')::date;
  quota jsonb := public.ai_quota();
  daily integer;
  next_used integer;
begin
  if (quota ->> 'unlimited')::boolean then
    return quota || jsonb_build_object('allowed', true);
  end if;
  daily := (quota ->> 'limit')::integer;
  if daily <= 0 then
    return quota || jsonb_build_object('allowed', false);
  end if;
  insert into private.ai_usage as u (user_id, day, used)
  values (uid, today, 1)
  on conflict (user_id, day) do update
    set used = u.used + 1
    where u.used < daily
  returning u.used into next_used;
  if next_used is null then
    return quota || jsonb_build_object('allowed', false, 'remaining', 0);
  end if;
  return quota || jsonb_build_object('allowed', true, 'used', next_used, 'remaining', greatest(daily - next_used, 0));
end;
$$;

create or replace function public.admin_set_ai_access(target_id uuid, unlimited boolean, daily_limit integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_email text;
begin
  if not private.is_owner() then
    raise exception 'Only the owner can change Scribble AI access';
  end if;
  select email into target_email from public.profiles where id = target_id;
  if target_email is null then
    raise exception 'User not found';
  end if;
  update public.profiles
  set ai_unlimited = coalesce(unlimited, false),
      ai_daily_limit = case when daily_limit is null or daily_limit < 0 then null else daily_limit end
  where id = target_id;
  perform private.write_audit(
    'ai-access',
    target_email,
    case
      when coalesce(unlimited, false) then 'unlimited'
      when daily_limit is null or daily_limit < 0 then 'app default'
      else daily_limit::text || ' per day'
    end
  );
end;
$$;

create or replace function public.admin_set_ai_default(daily_limit integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_owner() then
    raise exception 'Only the owner can change Scribble AI access';
  end if;
  update public.app_controls
  set ai_daily_limit = greatest(coalesce(daily_limit, 0), 0),
      updated_at = now()
  where id = 1;
  perform private.write_audit('ai-default', null, greatest(coalesce(daily_limit, 0), 0)::text || ' per day');
end;
$$;

create or replace function public.admin_reset_ai_usage(target_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_email text;
begin
  if not private.is_owner() then
    raise exception 'Only the owner can change Scribble AI access';
  end if;
  select email into target_email from public.profiles where id = target_id;
  if target_email is null then
    raise exception 'User not found';
  end if;
  delete from private.ai_usage where user_id = target_id and day = (now() at time zone 'utc')::date;
  perform private.write_audit('ai-reset', target_email, 'reset today''s uses');
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
    'users', coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc) from public.profiles as p), '[]'::jsonb),
    'admins', coalesce((select jsonb_agg(a.email order by a.email) from private.admin_users as a), '[]'::jsonb),
    'announcement', coalesce((select to_jsonb(n) from public.announcements as n where n.id = 1), '{}'::jsonb),
    'controls', coalesce((select to_jsonb(c) from public.app_controls as c where c.id = 1), '{}'::jsonb),
    'blocked', coalesce((select jsonb_agg(jsonb_build_object('email', b.email, 'reason', b.reason, 'created_at', b.created_at) order by b.created_at desc) from public.blocked_emails as b), '[]'::jsonb),
    'audit', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc) from (select id, actor_email, action, target_email, detail, created_at from public.admin_audit order by created_at desc limit 80) as e), '[]'::jsonb),
    'ai_used_today', coalesce((select jsonb_object_agg(u.user_id, u.used) from private.ai_usage as u where u.day = (now() at time zone 'utc')::date), '{}'::jsonb),
    'is_owner', private.is_owner()
  ) into result;
  return result;
end;
$$;

revoke all on function private.is_owner() from public, anon, authenticated;
revoke all on function public.ai_quota() from public, anon;
revoke all on function public.consume_ai_use() from public, anon;
revoke all on function public.admin_set_ai_access(uuid, boolean, integer) from public, anon;
revoke all on function public.admin_set_ai_default(integer) from public, anon;
revoke all on function public.admin_reset_ai_usage(uuid) from public, anon;

grant execute on function public.ai_quota() to authenticated;
grant execute on function public.consume_ai_use() to authenticated;
grant execute on function public.admin_set_ai_access(uuid, boolean, integer) to authenticated;
grant execute on function public.admin_set_ai_default(integer) to authenticated;
grant execute on function public.admin_reset_ai_usage(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
