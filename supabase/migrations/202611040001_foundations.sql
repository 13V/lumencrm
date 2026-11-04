-- Lumen adl CRM. Run with Supabase's migration role, never from a browser.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create type public.app_role as enum ('owner', 'staff', 'viewer');
create type public.deal_outcome as enum ('open', 'won', 'lost', 'unsuitable', 'noreply');
create type public.activity_type as enum ('call','sms_out','sms_in','email_out','email_in','note','meeting','form','stage_change','chloe_out','chloe_in','chloe_status','quote_sent','quote_viewed','quote_accepted','invoice_sent','payment','system');

create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  user_id uuid not null unique references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 200),
  role public.app_role not null default 'viewer', notification_prefs jsonb not null default '{}'::jsonb
);
create table public.user_invitations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  email text not null, role public.app_role not null default 'staff', name text not null default '',
  invited_by uuid references public.profiles(id), accepted_at timestamptz, expires_at timestamptz not null default now() + interval '7 days'
);
create unique index user_invitations_open_email on public.user_invitations(lower(email)) where accepted_at is null and deleted_at is null;
create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  name text not null check (length(name) between 1 and 200), trade text, abn text, website_url text, google_business_url text,
  suburb text, state text not null default 'SA', postcode text, service_areas text[] not null default '{}', notes text
);
create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  business_id uuid references public.businesses(id), first_name text not null default '', last_name text not null default '', role_title text,
  phone_e164 text check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'), phone_display text,
  email text check (email is null or length(email) <= 254),
  preferred_channel text not null default 'call' check (preferred_channel in ('call','sms','email')), best_time text,
  sms_opt_out_at timestamptz, email_opt_out_at timestamptz, do_not_contact boolean not null default false,
  anonymised_at timestamptz
);
create unique index contacts_phone_unique on public.contacts(phone_e164) where phone_e164 is not null;
create unique index contacts_email_unique on public.contacts(lower(email)) where email is not null;
create index contacts_business_idx on public.contacts(business_id);
create index contacts_search_idx on public.contacts using gin (to_tsvector('simple', first_name || ' ' || last_name || ' ' || coalesce(email, '') || ' ' || coalesce(phone_e164, '')));

create table public.products (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  name text not null, kind text not null check (kind in ('once','monthly')), price numeric(12,2) not null check (price >= 0),
  summary text, included text[] not null default '{}', active boolean not null default true, sort integer not null default 0
);
create table public.deals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  contact_id uuid not null references public.contacts(id), business_id uuid references public.businesses(id),
  title text not null check (length(title) between 1 and 300), product_id uuid references public.products(id), owner_id uuid references public.profiles(id),
  channel text not null default 'manual' check (channel in ('website','meta_form','chloe','referral','phone','business_card','manual','other')),
  stage_key text not null default 'new', stage_entered_at timestamptz not null default now(),
  outcome public.deal_outcome not null default 'open', lost_reason text, closed_at timestamptz,
  value_once numeric(12,2) check (value_once >= 0), value_monthly numeric(12,2) check (value_monthly >= 0),
  promised_text text, promised_due_at timestamptz, next_step text, next_step_at timestamptz,
  first_touch_at timestamptz, two_way_at timestamptz,
  presales_minutes integer not null default 0 check (presales_minutes >= 0), demo_build_minutes integer not null default 0 check (demo_build_minutes >= 0),
  "returning" boolean not null default false,
  chloe_status text check (chloe_status in ('queued','active','booked','handoff','done','stopped','human')),
  chloe_fields jsonb not null default '{}'::jsonb,
  merged_into_id uuid references public.deals(id)
);
create index deals_contact_idx on public.deals(contact_id);
create index deals_business_idx on public.deals(business_id);
create index deals_open_stage_idx on public.deals(stage_key, created_at desc) where deleted_at is null and outcome = 'open';
create index deals_next_step_idx on public.deals(next_step_at) where deleted_at is null and outcome = 'open';
create index deals_promised_idx on public.deals(promised_due_at) where deleted_at is null and outcome = 'open';
create index deals_owner_idx on public.deals(owner_id);
create index deals_created_idx on public.deals(created_at desc);
create table public.deal_milestones (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deal_id uuid not null references public.deals(id), milestone_key text not null, first_reached_at timestamptz not null default now(),
  reached_by uuid references public.profiles(id), unique(deal_id, milestone_key)
);
create table public.attribution (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deal_id uuid not null unique references public.deals(id),
  form_source text, page_url text, landing_url text, referrer text, landing_referrer text,
  utm_source text, utm_medium text, utm_campaign text, utm_term text, utm_content text,
  event_id text, fbp text, fbc text,
  meta_lead_id text, meta_form_id text, meta_form_name text, meta_ad_id text, meta_ad_name text,
  meta_adset_id text, meta_adset_name text, meta_campaign_id text, meta_campaign_name text, platform text, is_organic boolean,
  raw jsonb not null default '{}'::jsonb
);
create unique index attribution_meta_lead_idx on public.attribution(meta_lead_id) where meta_lead_id is not null;
create index attribution_utm_idx on public.attribution(utm_campaign, utm_content);
create index attribution_ad_idx on public.attribution(meta_ad_id);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  deal_id uuid references public.deals(id), contact_id uuid references public.contacts(id), created_by uuid references public.profiles(id),
  occurred_at timestamptz not null default now(), type public.activity_type not null,
  direction text check (direction in ('inbound','outbound')),
  outcome text check (outcome in ('reached','no_answer','voicemail','wrong_number','busy')),
  duration_seconds integer check (duration_seconds >= 0), body text, meta jsonb not null default '{}'::jsonb
);
create index activities_deal_time_idx on public.activities(deal_id, occurred_at desc);
create index activities_contact_time_idx on public.activities(contact_id, occurred_at desc);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  deal_id uuid references public.deals(id), business_id uuid references public.businesses(id), name text not null,
  stage_key text not null default 'kickoff', template_key text not null default 'website', kickoff_at timestamptz, launched_at timestamptz, site_url text,
  feature_permission text not null default 'unknown' check (feature_permission in ('unknown','asked','granted','declined')),
  feature_permission_at timestamptz, feature_permission_note text
);
create unique index projects_deal_idx on public.projects(deal_id) where deal_id is not null and deleted_at is null;
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  deal_id uuid references public.deals(id), contact_id uuid references public.contacts(id), project_id uuid references public.projects(id),
  title text not null check (length(title) between 1 and 500), notes text,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')), created_by uuid references public.profiles(id),
  due_at timestamptz, remind_at timestamptz, snoozed_until timestamptz, done_at timestamptz, rule_key text
);
create index tasks_due_idx on public.tasks(due_at) where deleted_at is null and done_at is null;
create index tasks_deal_idx on public.tasks(deal_id);
create index tasks_project_idx on public.tasks(project_id);
create unique index tasks_rule_idx on public.tasks(deal_id, rule_key) where rule_key is not null and deleted_at is null;
create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  deal_id uuid references public.deals(id), contact_id uuid references public.contacts(id),
  kind text not null default 'call' check (kind in ('call','meeting','demo_walkthrough')),
  starts_at timestamptz not null, ends_at timestamptz not null check (ends_at > starts_at),
  status text not null default 'booked' check (status in ('booked','done','no_show','cancelled','rescheduled')),
  source text not null default 'manual' check (source in ('chloe','manual')), notes text, ics_uid text not null unique default gen_random_uuid()::text || '@crm.lumenadl.com'
);
create index appointments_time_idx on public.appointments(starts_at) where deleted_at is null;
create index appointments_deal_idx on public.appointments(deal_id);
create table public.demos (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  deal_id uuid not null references public.deals(id), status text not null default 'to_build' check (status in ('to_build','building','sent','approved','superseded')),
  url text, sent_at timestamptz, build_minutes integer not null default 0 check (build_minutes >= 0), notes text
);
create index demos_deal_idx on public.demos(deal_id);
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  deal_id uuid not null references public.deals(id), number text not null unique,
  status text not null default 'draft' check (status in ('draft','sent','viewed','accepted','declined','expired','superseded')),
  public_token text not null unique default translate(rtrim(encode(extensions.gen_random_bytes(32),'base64'),'='),'+/','-_'),
  issued_at timestamptz, expires_at timestamptz, accepted_at timestamptz, accepted_name text, accepted_ip inet, accepted_user_agent text,
  view_count integer not null default 0 check (view_count >= 0), first_viewed_at timestamptz, last_viewed_at timestamptz,
  total_once numeric(12,2) not null default 0 check (total_once >= 0), total_monthly numeric(12,2) not null default 0 check (total_monthly >= 0), terms_url text, notes text,
  terms_snapshot jsonb not null default '{}'::jsonb
);
create index quotes_deal_idx on public.quotes(deal_id);
create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  quote_id uuid not null references public.quotes(id), product_id uuid references public.products(id), description text not null,
  qty numeric(12,2) not null default 1 check (qty > 0), unit_price numeric(12,2) not null check (unit_price >= 0),
  kind text not null check (kind in ('once','monthly')), included boolean not null default false, sort integer not null default 0
);
create index quote_items_quote_idx on public.quote_items(quote_id);
create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  project_id uuid not null references public.projects(id), section text not null default 'Build', title text not null, due_at timestamptz, done_at timestamptz, sort integer not null default 0
);
create index checklist_project_idx on public.checklist_items(project_id);
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  business_id uuid not null references public.businesses(id), product_id uuid references public.products(id), price numeric(12,2) not null check (price >= 0),
  status text not null default 'active' check (status in ('active','paused','cancelled')),
  started_on date not null default current_date, billing_day smallint not null check (billing_day between 1 and 28), next_invoice_on date, cancelled_on date, status_reason text
);
create index subscriptions_billing_idx on public.subscriptions(next_invoice_on) where status = 'active' and deleted_at is null;
create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  number text not null unique, status text not null default 'draft' check (status in ('draft','sent','part_paid','paid','void')),
  business_id uuid references public.businesses(id), contact_id uuid references public.contacts(id), deal_id uuid references public.deals(id),
  project_id uuid references public.projects(id), subscription_id uuid references public.subscriptions(id),
  issued_on date not null default current_date, due_on date not null, sent_at timestamptz, paid_at timestamptz,
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0), gst numeric(12,2) not null default 0 check (gst >= 0), total numeric(12,2) not null default 0 check (total >= 0),
  notes text, gst_wording text, billing_snapshot jsonb not null default '{}'::jsonb,
  check (total = subtotal + gst)
);
create index invoices_due_idx on public.invoices(due_on) where status in ('sent','part_paid') and deleted_at is null;
create index invoices_business_idx on public.invoices(business_id);
create unique index invoices_subscription_period_idx on public.invoices(subscription_id, issued_on) where subscription_id is not null and deleted_at is null and status <> 'void';
create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  invoice_id uuid not null references public.invoices(id), product_id uuid references public.products(id), description text not null,
  qty numeric(12,2) not null default 1 check (qty > 0), unit_price numeric(12,2) not null check (unit_price >= 0),
  included boolean not null default false, sort integer not null default 0
);
create index invoice_items_invoice_idx on public.invoice_items(invoice_id);
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  invoice_id uuid not null references public.invoices(id), amount numeric(12,2) not null check (amount > 0), received_on date not null default current_date,
  method text not null default 'bank_transfer', reference text
);
create index payments_invoice_idx on public.payments(invoice_id);
create table public.ad_spend_daily (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  date date not null, ad_id text not null, account_id text, campaign_id text, campaign_name text, adset_id text, adset_name text, ad_name text,
  spend numeric(12,2) not null default 0 check (spend >= 0), impressions bigint not null default 0 check (impressions >= 0), clicks bigint not null default 0 check (clicks >= 0),
  link_clicks bigint not null default 0 check (link_clicks >= 0), meta_leads bigint not null default 0 check (meta_leads >= 0), imported_at timestamptz not null default now(),
  unique(date, ad_id)
);
create index spend_campaign_date_idx on public.ad_spend_daily(campaign_id, date);
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  channel text not null check (channel in ('sms','email')), name text not null, subject text, body text not null, active boolean not null default true
);
create table public.automations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  key text not null unique, enabled boolean not null default true, config jsonb not null default '{}'::jsonb
);
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  contact_id uuid not null references public.contacts(id), channel text not null check (channel in ('sms','email')),
  status text not null check (status in ('opt_in','opt_out')), source text not null, evidence text, at timestamptz not null default now()
);
create index consents_contact_idx on public.consents(contact_id, channel, at desc);
create table public.files (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  entity text not null check (entity in ('deal','contact','business','project','quote','invoice')), entity_id uuid not null,
  path text not null unique, name text not null, mime text not null, size bigint not null check (size >= 0)
);
create index files_entity_idx on public.files(entity, entity_id);
create table public.tags (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  name text not null unique
);
create table public.taggings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  tag_id uuid not null references public.tags(id), entity text not null, entity_id uuid not null, unique(tag_id,entity,entity_id)
);
create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  user_id uuid not null references auth.users(id) on delete cascade, entity text not null, name text not null,
  filters jsonb not null default '{}'::jsonb, sort jsonb not null default '{}'::jsonb
);
create table public.integration_inbox (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  source text not null, idempotency_key text not null unique, received_at timestamptz not null default now(),
  status text not null default 'received' check (status in ('received','processing','processed','failed')),
  error text, deal_id uuid references public.deals(id), processed_at timestamptz
);
create table public.capi_outbox (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  deal_id uuid not null references public.deals(id), event_name text not null check (event_name <> 'Lead'), event_id text not null unique,
  payload jsonb not null, status text not null default 'pending' check (status in ('pending','processing','sent','failed','skipped')),
  attempts integer not null default 0 check (attempts >= 0), last_error text, sent_at timestamptz, next_attempt_at timestamptz not null default now(), locked_at timestamptz
);
create index capi_pending_idx on public.capi_outbox(next_attempt_at) where status in ('pending','failed');
create table public.notifications_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  event_key text not null, entity_id uuid, channel text not null, status text not null default 'pending', error text, sent_at timestamptz,
  unique(event_key, channel)
);
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  actor uuid, action text not null, entity text not null, entity_id uuid, diff jsonb not null default '{}'::jsonb, at timestamptz not null default now()
);
create index audit_entity_idx on public.audit_log(entity, entity_id, at desc);
create table public.settings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  singleton boolean not null default true unique check (singleton), config jsonb not null default '{}'::jsonb
);
create table public.message_drafts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  contact_id uuid not null references public.contacts(id), deal_id uuid references public.deals(id), invoice_id uuid references public.invoices(id),
  channel text not null check (channel in ('sms','email')), subject text, body text not null,
  status text not null default 'draft' check (status in ('draft','sent','cancelled')), rule_key text unique, sent_at timestamptz
);
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  user_id uuid not null references auth.users(id) on delete cascade, endpoint text not null unique, p256dh text not null, auth text not null
);
create table public.calendar_tokens (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  user_id uuid not null references auth.users(id) on delete cascade, token_hash text not null unique, revoked_at timestamptz
);
create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  key text not null unique, status text not null default 'pending' check (status in ('pending','running','done','failed')),
  attempts integer not null default 0, locked_at timestamptz, finished_at timestamptz, error text,
  entity_id uuid, kind text, run_at timestamptz not null default now()
);
create index job_runs_pending_idx on public.job_runs(run_at) where status in ('pending','failed');

-- Authentication helpers live behind SECURITY DEFINER with a fixed, empty search path.
-- AAL1 owners can read only their own profile to complete TOTP; app records require AAL2.
create function public.current_app_role() returns text language sql stable security definer set search_path = '' as $$
  select case when p.role = 'owner' and coalesce(auth.jwt()->>'aal','aal1') <> 'aal2' then null else p.role::text end
  from public.profiles p where p.user_id = auth.uid() and p.deleted_at is null
$$;
create function public.has_role(allowed text[]) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_app_role() = any(allowed), false)
$$;
create function public.current_profile_id() returns uuid language sql stable security definer set search_path = '' as $$
  select p.id from public.profiles p where p.user_id = auth.uid() and p.deleted_at is null
$$;
create function public.is_service() returns boolean language sql stable set search_path = '' as $$
  select coalesce(auth.role() = 'service_role', false)
$$;
create function public.get_my_profile() returns setof public.profiles language sql stable security definer set search_path = '' as $$
  select p.* from public.profiles p where p.user_id = auth.uid() and p.deleted_at is null
$$;

-- Enable RLS on every public table. No anonymous data access or hard deletes.
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('grant select, insert, update on table public.%I to authenticated', t);
    execute format('revoke delete, truncate, references, trigger on table public.%I from authenticated', t);
    execute format('grant all on table public.%I to service_role', t);
  end loop;
end $$;

create policy profile_self_read on public.profiles for select to authenticated using (user_id = auth.uid() and deleted_at is null);
create policy profile_owner_read on public.profiles for select to authenticated using (public.has_role(array['owner']));
create policy profile_owner_write on public.profiles for all to authenticated using (public.has_role(array['owner'])) with check (public.has_role(array['owner']));

-- Staff can work on sales and delivery, but cannot delete or access finance/settings.
do $$ declare t text; begin
  foreach t in array array['businesses','contacts','deals','activities','tasks','appointments','demos','projects','checklist_items','tags','taggings'] loop
    execute format('create policy app_read on public.%I for select to authenticated using (public.has_role(array[''owner'']) or (deleted_at is null and public.has_role(array[''staff'',''viewer''])))', t);
    execute format('create policy app_insert on public.%I for insert to authenticated with check (public.has_role(array[''owner'']) or (deleted_at is null and public.has_role(array[''staff''])))', t);
    execute format('create policy app_update on public.%I for update to authenticated using (public.has_role(array[''owner'']) or (deleted_at is null and public.has_role(array[''staff'']))) with check (public.has_role(array[''owner'']) or (deleted_at is null and public.has_role(array[''staff''])))', t);
  end loop;
  foreach t in array array['products','templates'] loop
    execute format('create policy reference_read on public.%I for select to authenticated using (public.has_role(array[''owner'']) or (deleted_at is null and public.has_role(array[''staff'',''viewer''])))', t);
    execute format('create policy reference_owner_write on public.%I for all to authenticated using (public.has_role(array[''owner''])) with check (public.has_role(array[''owner'']))', t);
  end loop;
  foreach t in array array['quotes','quote_items','subscriptions','invoices','invoice_items','payments'] loop
    execute format('create policy finance_read on public.%I for select to authenticated using (public.has_role(array[''owner'']) or (deleted_at is null and public.has_role(array[''viewer''])))', t);
    execute format('create policy finance_owner_write on public.%I for all to authenticated using (public.has_role(array[''owner''])) with check (public.has_role(array[''owner'']))', t);
  end loop;
  foreach t in array array['settings','automations','user_invitations','integration_inbox','capi_outbox','notifications_log','audit_log','job_runs'] loop
    execute format('create policy owner_read on public.%I for select to authenticated using (public.has_role(array[''owner'']))', t);
  end loop;
  foreach t in array array['settings','automations','user_invitations'] loop
    execute format('create policy owner_write on public.%I for all to authenticated using (public.has_role(array[''owner''])) with check (public.has_role(array[''owner'']))', t);
  end loop;
  foreach t in array array['deal_milestones','attribution','consents'] loop
    execute format('create policy history_read on public.%I for select to authenticated using (public.has_role(array[''owner'',''staff'',''viewer'']))', t);
  end loop;
end $$;
-- History is written by vetted functions/triggers or the ingestion service only.
create policy ads_owner_viewer_read on public.ad_spend_daily for select to authenticated using (public.has_role(array['owner','viewer']));
create policy files_read on public.files for select to authenticated using (
  public.has_role(array['owner']) or (deleted_at is null and (public.has_role(array['viewer']) or (public.has_role(array['staff']) and entity not in ('invoice','quote'))))
);
create policy files_write on public.files for insert to authenticated with check (
  public.has_role(array['owner']) or (deleted_at is null and public.has_role(array['staff']) and entity not in ('invoice','quote'))
);
create policy files_update on public.files for update to authenticated using (
  public.has_role(array['owner']) or (deleted_at is null and public.has_role(array['staff']) and entity not in ('invoice','quote'))
) with check (public.has_role(array['owner']) or (deleted_at is null and public.has_role(array['staff']) and entity not in ('invoice','quote')));
create policy drafts_read on public.message_drafts for select to authenticated using (
  public.has_role(array['owner','viewer']) or (deleted_at is null and invoice_id is null and public.has_role(array['staff']))
);
create policy drafts_write on public.message_drafts for all to authenticated using (
  public.has_role(array['owner']) or (deleted_at is null and invoice_id is null and public.has_role(array['staff']))
) with check (public.has_role(array['owner']) or (deleted_at is null and invoice_id is null and public.has_role(array['staff'])));
do $$ declare t text; begin
  foreach t in array array['saved_views','push_subscriptions','calendar_tokens'] loop
    execute format('create policy own_read on public.%I for select to authenticated using (user_id = auth.uid() and public.has_role(array[''owner'',''staff'',''viewer'']))',t);
    execute format('create policy own_write on public.%I for all to authenticated using (user_id = auth.uid() and public.has_role(array[''owner'',''staff''])) with check (user_id = auth.uid() and public.has_role(array[''owner'',''staff'']))',t);
  end loop;
end $$;

-- Updated timestamps and audit records. Audit diffs contain changed field names only,
-- never names, phones, message bodies, bank details or authentication material.
create function public.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$ begin new.updated_at = now(); return new; end $$;
create function public.write_audit_log() returns trigger language plpgsql security definer set search_path = '' as $$
declare old_json jsonb; new_json jsonb; changed jsonb; entity_uuid uuid;
begin
  old_json := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  new_json := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  entity_uuid := coalesce((new_json->>'id')::uuid,(old_json->>'id')::uuid);
  select coalesce(jsonb_object_agg(k, jsonb_build_object('changed',true)), '{}'::jsonb) into changed
  from (select key k from jsonb_object_keys(old_json || new_json) key where old_json->key is distinct from new_json->key and key <> 'updated_at') keys;
  insert into public.audit_log(actor,action,entity,entity_id,diff) values(auth.uid(),lower(tg_op),tg_table_name,entity_uuid,changed);
  return case when tg_op = 'DELETE' then old else new end;
end $$;
do $$ declare t text; begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('create trigger touch_updated_at before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
  foreach t in array array['profiles','businesses','contacts','deals','activities','tasks','appointments','demos','quotes','quote_items','projects','checklist_items','subscriptions','invoices','invoice_items','payments','consents','settings','products','automations','user_invitations','files','message_drafts'] loop
    execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function public.write_audit_log()', t);
  end loop;
end $$;

create function public.protect_profile_role() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.role = 'owner' and old.deleted_at is null and (new.role <> 'owner' or new.deleted_at is not null) then
    perform pg_advisory_xact_lock(hashtext('lumen:owner-role'));
    if not exists(select 1 from public.profiles where role = 'owner' and deleted_at is null and id <> old.id) then
      raise exception 'The last owner cannot be removed' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.user_id <> old.user_id then raise exception 'Profile user cannot be changed' using errcode = '23514'; end if;
  return new;
end $$;
create trigger protect_profile_role before update on public.profiles for each row execute function public.protect_profile_role();

-- No public signup bootstrap. An owner is created explicitly by a trusted SQL operator.
-- Invitations are consumed only after the auth provider has verified the email.
create function public.accept_invitation() returns public.profiles language plpgsql security definer set search_path = '' as $$
declare invitation public.user_invitations; result public.profiles; verified_email text;
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select * into result from public.profiles where user_id = auth.uid() and deleted_at is null;
  if found then return result; end if;
  select lower(email) into verified_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if verified_email is null then raise exception 'Verified email required' using errcode = '42501'; end if;
  select * into invitation from public.user_invitations where lower(email) = verified_email and accepted_at is null and deleted_at is null and expires_at > now() for update;
  if not found then raise exception 'No active invitation' using errcode = '42501'; end if;
  insert into public.profiles(user_id,name,role) values(auth.uid(),coalesce(nullif(invitation.name,''),split_part(verified_email,'@',1)),invitation.role) returning * into result;
  update public.user_invitations set accepted_at = now() where id = invitation.id;
  return result;
end $$;

create function public.get_configuration() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c jsonb;
begin
  if not public.has_role(array['owner','staff','viewer']) and not public.is_service() then raise exception 'Forbidden' using errcode = '42501'; end if;
  select config into c from public.settings where singleton;
  return jsonb_build_object('sales_stages', c->'sales_stages', 'delivery_stages', c->'delivery_stages', 'call_hours', c->'call_hours', 'speed_to_lead_minutes', c->'speed_to_lead_minutes', 'source_labels', c->'source_labels', 'lost_reasons', c->'lost_reasons', 'project_templates', c->'project_templates');
end $$;

-- All functions are private unless explicitly granted below.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.current_app_role(), public.has_role(text[]), public.current_profile_id(), public.is_service(), public.get_my_profile(), public.accept_invitation(), public.get_configuration() to authenticated, service_role;

-- Private storage. Finance paths use their own prefix and are invisible to staff.
insert into storage.buckets(id,name,public,file_size_limit) values('crm-files','crm-files',false,26214400),('crm-backups','crm-backups',false,104857600) on conflict(id) do nothing;
create policy crm_file_read on storage.objects for select to authenticated using (bucket_id = 'crm-files' and (public.has_role(array['owner','viewer']) or (public.has_role(array['staff']) and (storage.foldername(name))[1] not in ('invoice','quote'))));
create policy crm_file_insert on storage.objects for insert to authenticated with check (bucket_id = 'crm-files' and (public.has_role(array['owner']) or (public.has_role(array['staff']) and (storage.foldername(name))[1] in ('deal','contact','business','project'))));
create policy crm_file_update on storage.objects for update to authenticated using (bucket_id = 'crm-files' and public.has_role(array['owner'])) with check (bucket_id = 'crm-files' and public.has_role(array['owner']));
create policy crm_file_delete on storage.objects for delete to authenticated using (bucket_id = 'crm-files' and public.has_role(array['owner']));

-- Realtime subscriptions still pass the table's RLS checks.
do $$ declare t text; begin
  if exists(select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['deals','contacts','activities','tasks','appointments','quotes','invoices'] loop
      execute format('alter publication supabase_realtime add table public.%I', t);
    end loop;
  end if;
end $$;
