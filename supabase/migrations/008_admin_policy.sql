alter table public.app_controls
  add column if not exists signup_message text not null default '',
  add column if not exists allowed_domain text not null default '',
  add column if not exists min_version text not null default '',
  add column if not exists update_message text not null default '',
  add column if not exists support_email text not null default '',
  add column if not exists welcome_title text not null default '',
  add column if not exists welcome_body text not null default '',
  add column if not exists status_line text not null default '',
  add column if not exists dashboard_kicker text not null default '',
  add column if not exists dashboard_headline text not null default '',
  add column if not exists lock_theme text not null default '',
  add column if not exists live_on boolean not null default true,
  add column if not exists ocr_on boolean not null default true,
  add column if not exists ai_on boolean not null default true,
  add column if not exists analytics_on boolean not null default true,
  add column if not exists templates_on boolean not null default true,
  add column if not exists scribbles_on boolean not null default true,
  add column if not exists clipboard_on boolean not null default true,
  add column if not exists typing_on boolean not null default true,
  add column if not exists read_only boolean not null default false,
  add column if not exists force_repair boolean not null default false,
  add column if not exists allow_typos boolean not null default true,
  add column if not exists allow_pauses boolean not null default true,
  add column if not exists hotkeys_on boolean not null default true,
  add column if not exists overlay_on boolean not null default true,
  add column if not exists onboarding_on boolean not null default true,
  add column if not exists backup_on boolean not null default true,
  add column if not exists max_wpm integer not null default 0,
  add column if not exists max_chars integer not null default 0,
  add column if not exists default_wpm integer not null default 0,
  add column if not exists default_countdown_sec integer not null default 0;

create or replace function public.admin_save_policy(payload jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  chosen_theme text := lower(trim(coalesce(payload->>'lock_theme', '')));
begin
  perform private.assert_admin();
  if chosen_theme not in (
    '', 'cobalt', 'bloodlust', 'toxic', 'hearth', 'tide', 'noir', 'sketch',
    'classic_light', 'frost', 'parchment', 'classic_dark'
  ) then
    chosen_theme := '';
  end if;
  update public.app_controls
  set signups_open = coalesce((payload->>'signups_open')::boolean, signups_open),
      signups_closed_at = case
        when coalesce((payload->>'signups_open')::boolean, signups_open) then null
        else coalesce(signups_closed_at, now())
      end,
      maintenance_on = coalesce((payload->>'maintenance_on')::boolean, maintenance_on),
      maintenance_message = coalesce(payload->>'maintenance_message', maintenance_message),
      signup_message = coalesce(payload->>'signup_message', signup_message),
      allowed_domain = lower(trim(coalesce(payload->>'allowed_domain', allowed_domain))),
      min_version = trim(coalesce(payload->>'min_version', min_version)),
      update_message = coalesce(payload->>'update_message', update_message),
      support_email = lower(trim(coalesce(payload->>'support_email', support_email))),
      welcome_title = coalesce(payload->>'welcome_title', welcome_title),
      welcome_body = coalesce(payload->>'welcome_body', welcome_body),
      status_line = coalesce(payload->>'status_line', status_line),
      dashboard_kicker = coalesce(payload->>'dashboard_kicker', dashboard_kicker),
      dashboard_headline = coalesce(payload->>'dashboard_headline', dashboard_headline),
      lock_theme = chosen_theme,
      live_on = coalesce((payload->>'live_on')::boolean, live_on),
      ocr_on = coalesce((payload->>'ocr_on')::boolean, ocr_on),
      ai_on = coalesce((payload->>'ai_on')::boolean, ai_on),
      analytics_on = coalesce((payload->>'analytics_on')::boolean, analytics_on),
      templates_on = coalesce((payload->>'templates_on')::boolean, templates_on),
      scribbles_on = coalesce((payload->>'scribbles_on')::boolean, scribbles_on),
      clipboard_on = coalesce((payload->>'clipboard_on')::boolean, clipboard_on),
      typing_on = coalesce((payload->>'typing_on')::boolean, typing_on),
      read_only = coalesce((payload->>'read_only')::boolean, read_only),
      force_repair = coalesce((payload->>'force_repair')::boolean, force_repair),
      allow_typos = coalesce((payload->>'allow_typos')::boolean, allow_typos),
      allow_pauses = coalesce((payload->>'allow_pauses')::boolean, allow_pauses),
      hotkeys_on = coalesce((payload->>'hotkeys_on')::boolean, hotkeys_on),
      overlay_on = coalesce((payload->>'overlay_on')::boolean, overlay_on),
      onboarding_on = coalesce((payload->>'onboarding_on')::boolean, onboarding_on),
      backup_on = coalesce((payload->>'backup_on')::boolean, backup_on),
      max_wpm = greatest(coalesce((payload->>'max_wpm')::integer, max_wpm), 0),
      max_chars = greatest(coalesce((payload->>'max_chars')::integer, max_chars), 0),
      default_wpm = greatest(coalesce((payload->>'default_wpm')::integer, default_wpm), 0),
      default_countdown_sec = greatest(coalesce((payload->>'default_countdown_sec')::integer, default_countdown_sec), 0),
      updated_at = now()
  where id = 1;
  perform private.write_audit('policy', null, 'saved app policy');
end;
$$;

revoke all on function public.admin_save_policy(jsonb) from public, anon;
grant execute on function public.admin_save_policy(jsonb) to authenticated;

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
  domain_blocked boolean := false;
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
  domain_blocked :=
    coalesce(controls.allowed_domain, '') <> ''
    and account_email <> ''
    and account_email <> 'az.i.zisnotme@gmail.com'
    and not admin_account
    and account_email not like '%@' || lower(trim(controls.allowed_domain));
  if domain_blocked and block_reason is null then
    block_reason := 'This email domain is not allowed.';
  end if;

  return jsonb_build_object(
    'blocked', (block_reason is not null or domain_blocked) and not admin_account,
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

notify pgrst, 'reload schema';
