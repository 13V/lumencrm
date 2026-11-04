-- Run once in the Supabase SQL editor, after creating your verified Auth user.
-- Replace the example email below. Never use a public signup trigger for owners.
do $$
declare
  owner_email text := 'replace-with-your-email@example.com';
  owner_user_id uuid;
begin
  if exists(select 1 from public.profiles where role='owner' and deleted_at is null) then
    raise exception 'An owner already exists. Use the CRM invitation flow for further users.';
  end if;
  select id into owner_user_id from auth.users where lower(email)=lower(owner_email) and email_confirmed_at is not null;
  if owner_user_id is null then raise exception 'Create and verify this Auth user first.'; end if;
  insert into public.profiles(user_id,name,role) values(owner_user_id,'Troy Watson','owner');
end $$;
-- The owner must enrol and verify TOTP before RLS allows access to CRM data.
