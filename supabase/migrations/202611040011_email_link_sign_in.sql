-- Troy, 4 Nov 2026: sign in with an email link only, no authenticator app.
-- Owners now get their role with an email-link session (AAL1), like staff and viewers.
-- Sign-in stays invite-only: public sign-ups are disabled and the first owner is provisioned explicitly.
create or replace function public.current_app_role() returns text language sql stable security definer set search_path = '' as $$
  select p.role::text
  from public.profiles p where p.user_id = auth.uid() and p.deleted_at is null
$$;
