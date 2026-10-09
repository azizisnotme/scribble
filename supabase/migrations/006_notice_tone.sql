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

notify pgrst, 'reload schema';
