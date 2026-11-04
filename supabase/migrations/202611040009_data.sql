alter table public.settings add column revision bigint not null default 1;
alter table public.files add column upload_status text not null default 'ready' check(upload_status in ('pending','ready','failed'));
alter table public.files add column uploaded_by uuid references public.profiles(id);
create function public.increment_settings_revision() returns trigger language plpgsql set search_path='' as $$ begin new.revision:=old.revision+1; return new; end $$;
create trigger increment_settings_revision before update on public.settings for each row execute function public.increment_settings_revision();
create function public.save_settings(p_config jsonb,p_expected_revision bigint) returns public.settings language plpgsql security definer set search_path='' as $$
declare current_row public.settings; merged jsonb; pipeline text; required_keys text[]; stages jsonb;
begin
  if not public.has_role(array['owner']) then raise exception 'Owner access required' using errcode='42501'; end if;
  select * into current_row from public.settings where singleton for update;
  if p_expected_revision is null or current_row.revision<>p_expected_revision then raise exception 'Settings changed in another action. Reload before saving.' using errcode='40001'; end if;
  if jsonb_typeof(p_config)<>'object' or octet_length(p_config::text)>100000 then raise exception 'Invalid configuration' using errcode='22023'; end if;
  foreach pipeline in array array['sales_stages','delivery_stages'] loop
    stages:=p_config->pipeline;
    required_keys:=case when pipeline='sales_stages' then array['new','contacted','suitable','call_booked','brief','demo','quote','won']
      else array['kickoff','content','design','build','review','launched','local_seo','hosting'] end;
    if stages is null or jsonb_typeof(stages)<>'array' then raise exception 'Both pipelines need a stage list' using errcode='22023'; end if;
    if jsonb_array_length(stages) not between 8 and 50 then raise exception 'Keep the required stages and use at most 50 stages per pipeline' using errcode='22023'; end if;
    if exists(select 1 from jsonb_array_elements(stages) item where jsonb_typeof(item)<>'object' or
      coalesce(item->>'key','')!~'^[a-z][a-z0-9_]{0,99}$' or length(trim(coalesce(item->>'label',''))) not between 1 and 100) then
      raise exception 'Stage keys must be lowercase letters, numbers or underscores; labels need 1 to 100 characters' using errcode='22023';
    end if;
    if (select count(distinct item->>'key') from jsonb_array_elements(stages) item)<>jsonb_array_length(stages) then raise exception 'Stage keys must be unique' using errcode='22023'; end if;
    if exists(select 1 from unnest(required_keys) required where not exists(select 1 from jsonb_array_elements(stages) item where item->>'key'=required)) then
      raise exception 'Keep the canonical stage keys used by the integrations; labels and ordering are editable' using errcode='22023';
    end if;
  end loop;
  merged:=p_config;
  -- These counters belong to the atomic quote/invoice writers, never to a form snapshot.
  merged:=jsonb_set(merged,'{quotes}',coalesce(merged->'quotes','{}')||jsonb_build_object('next_number',current_row.config#>'{quotes,next_number}'));
  merged:=jsonb_set(merged,'{invoices}',coalesce(merged->'invoices','{}')||jsonb_build_object('next_number',current_row.config#>'{invoices,next_number}'));
  update public.settings set config=merged where id=current_row.id returning * into current_row;
  return current_row;
end $$;

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id),content_hash text not null check(length(content_hash)=64),
  entity text not null check(entity in ('contacts','deals')),total_rows integer not null check(total_rows between 1 and 1000),
  status text not null default 'running' check(status in ('running','complete'))
);
create table public.import_rows (
  id uuid primary key default gen_random_uuid(),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  batch_id uuid not null references public.import_batches(id),row_number integer not null check(row_number between 2 and 1001),
  row_hash text not null check(length(row_hash)=64),contact_id uuid references public.contacts(id),deal_id uuid references public.deals(id),
  business_id uuid references public.businesses(id),was_match boolean not null default false,unique(batch_id,row_number)
);
alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;
revoke all on public.import_batches,public.import_rows from anon,authenticated;
grant select on public.import_batches,public.import_rows to authenticated;
grant all on public.import_batches,public.import_rows to service_role;
create policy import_batch_owner_read on public.import_batches for select to authenticated using(public.has_role(array['owner']));
create policy import_row_owner_read on public.import_rows for select to authenticated using(public.has_role(array['owner']));
create trigger touch_updated_at before update on public.import_batches for each row execute function public.touch_updated_at();
create trigger touch_updated_at before update on public.import_rows for each row execute function public.touch_updated_at();

create function public.prepare_import_batch(p_id uuid,p_hash text,p_entity text,p_total integer) returns public.import_batches language plpgsql security definer set search_path='' as $$
declare batch public.import_batches;
begin
  if not public.has_role(array['owner']) then raise exception 'Owner access required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtext('import:'||p_id));
  select * into batch from public.import_batches where id=p_id;
  if batch.id is not null then
    if batch.content_hash<>p_hash or batch.entity<>p_entity or batch.total_rows<>p_total or batch.created_by<>public.current_profile_id() then raise exception 'This import identifier belongs to different data. Preview again to start a new import.' using errcode='23514'; end if;
    return batch;
  end if;
  insert into public.import_batches(id,created_by,content_hash,entity,total_rows) values(p_id,public.current_profile_id(),p_hash,p_entity,p_total) returning * into batch;
  return batch;
end $$;

create function public.import_lead_row(p_batch_id uuid,p_row_number integer,p_row_hash text,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare batch public.import_batches; receipt public.import_rows; result jsonb; c public.contacts; b public.businesses; d public.deals;
  phone text:=nullif(p_input->>'phone_e164',''); email_address text:=nullif(lower(trim(p_input->>'email')),''); patch jsonb; key text;
begin
  if not public.has_role(array['owner']) then raise exception 'Owner access required' using errcode='42501'; end if;
  select * into batch from public.import_batches where id=p_batch_id and created_by=public.current_profile_id() for update;
  if batch.id is null then raise exception 'Preview this import first' using errcode='P0002'; end if;
  if p_row_number<2 or p_row_number>batch.total_rows+1 then raise exception 'Invalid import row' using errcode='22023'; end if;
  select * into receipt from public.import_rows where batch_id=p_batch_id and row_number=p_row_number;
  if receipt.id is not null then
    if receipt.row_hash<>p_row_hash then raise exception 'This row changed. Start a new import.' using errcode='23514'; end if;
    return jsonb_build_object('row',p_row_number,'deal_id',receipt.deal_id,'contact_id',receipt.contact_id,'business_id',receipt.business_id,'skipped',true,'duplicate',receipt.was_match);
  end if;
  if batch.entity='contacts' then
    if nullif(trim(p_input->>'first_name'),'') is null or (phone is null and email_address is null) then raise exception 'A name and phone or email are required' using errcode='22023'; end if;
    if phone is not null then perform pg_advisory_xact_lock(hashtext('phone:'||phone)); end if;
    if email_address is not null then perform pg_advisory_xact_lock(hashtext('email:'||email_address)); end if;
    if phone is not null then select * into c from public.contacts where phone_e164=phone for update; end if;
    if c.id is null and email_address is not null then select * into c from public.contacts where lower(email)=email_address for update; end if;
    if c.id is null then
      if nullif(trim(p_input->>'business'),'') is not null then
        insert into public.businesses(name,trade,suburb,website_url,notes) values(p_input->>'business',p_input->>'trade',p_input->>'suburb',p_input->>'website',p_input->>'message') returning * into b;
      end if;
      insert into public.contacts(business_id,first_name,last_name,phone_e164,phone_display,email)
        values(b.id,p_input->>'first_name',coalesce(p_input->>'last_name',''),phone,p_input->>'phone_display',email_address) returning * into c;
      result:=jsonb_build_object('contact_id',c.id,'business_id',b.id,'duplicate',false);
    else
      if c.deleted_at is not null then raise exception 'Matching contact is in the bin; restore it first' using errcode='23514'; end if;
      result:=jsonb_build_object('contact_id',c.id,'business_id',c.business_id,'duplicate',true);
    end if;
  else
    result:=public.create_lead(p_input);
    -- Returning enquiries add their source note without overwriting live sales state.
    if not (result->>'duplicate')::boolean then
      patch:='{}'::jsonb;
      foreach key in array array['stage_key','outcome','lost_reason','next_step','next_step_at','promised_text','promised_due_at','value_once','value_monthly','presales_minutes','demo_build_minutes'] loop
        if p_input ? key then patch:=patch||jsonb_build_object(key,p_input->key); end if;
      end loop;
      d:=public.patch_deal((result->>'deal_id')::uuid,patch,p_input->>'override_reason');
      update public.deals set first_touch_at=nullif(p_input->>'first_touch_at','')::timestamptz,two_way_at=coalesce(nullif(p_input->>'two_way_at','')::timestamptz,two_way_at)
        where id=d.id;
      insert into public.activities(deal_id,contact_id,created_by,type,body,meta)
        values(d.id,d.contact_id,public.current_profile_id(),'system','Imported from CSV',jsonb_build_object('batch_id',batch.id,'row',p_row_number));
    end if;
  end if;
  insert into public.import_rows(batch_id,row_number,row_hash,contact_id,deal_id,business_id,was_match)
    values(batch.id,p_row_number,p_row_hash,(result->>'contact_id')::uuid,(result->>'deal_id')::uuid,(result->>'business_id')::uuid,coalesce((result->>'duplicate')::boolean,false));
  if (select count(*) from public.import_rows where batch_id=batch.id)=batch.total_rows then update public.import_batches set status='complete' where id=batch.id; end if;
  return result||jsonb_build_object('row',p_row_number,'skipped',false);
end $$;

-- Owner privacy actions may synchronously delete queued private files without a
-- service-role key. Jobs use the same queue after interruptions.
alter table public.storage_deletions add column contact_id uuid references public.contacts(id);
alter table public.storage_deletions add column delete_after timestamptz not null default now();
create function public.link_storage_redaction() returns trigger language plpgsql security definer set search_path='' as $$
declare contact_uuid uuid:=nullif(current_setting('lumen.anonymising_contact',true),'')::uuid;
begin
  if contact_uuid is not null and new.path<>old.path then update public.storage_deletions set contact_id=coalesce(contact_id,contact_uuid) where path=old.path; end if;
  return new;
end $$;
create trigger link_storage_redaction before update of path on public.files for each row execute function public.link_storage_redaction();
create function public.person_storage_paths(p_contact_id uuid) returns text[] language plpgsql security definer set search_path='' as $$
declare paths text[];
begin
  if not public.has_role(array['owner']) then raise exception 'Owner access required' using errcode='42501'; end if;
  select coalesce(array_agg(f.path),'{}') into paths from public.files f where
    (f.entity='contact' and f.entity_id=p_contact_id) or
    (f.entity='deal' and f.entity_id in(select id from public.deals where contact_id=p_contact_id)) or
    (f.entity='project' and f.entity_id in(select p.id from public.projects p join public.deals d on d.id=p.deal_id where d.contact_id=p_contact_id)) or
    (f.entity='quote' and f.entity_id in(select q.id from public.quotes q join public.deals d on d.id=q.deal_id where d.contact_id=p_contact_id)) or
    (f.entity='invoice' and f.entity_id in(select i.id from public.invoices i left join public.deals d on d.id=i.deal_id where i.contact_id=p_contact_id or d.contact_id=p_contact_id)) or
    (f.entity='business' and f.entity_id in(select business_id from public.contacts where id=p_contact_id) and not exists(select 1 from public.contacts other where other.business_id=f.entity_id and other.id<>p_contact_id and other.anonymised_at is null));
  select coalesce(array_agg(distinct path),'{}') into paths from (
    select unnest(paths) path union select path from public.storage_deletions where contact_id=p_contact_id and done_at is null
  ) all_paths where path not like 'deleted/%';
  return paths;
end $$;
create function public.mark_storage_deleted(p_paths text[]) returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.has_role(array['owner']) then raise exception 'Owner access required' using errcode='42501'; end if;
  update public.storage_deletions set done_at=now(),error=null where path=any(p_paths);
end $$;

revoke all on function public.increment_settings_revision(),public.save_settings(jsonb,bigint),public.prepare_import_batch(uuid,text,text,integer),public.import_lead_row(uuid,integer,text,jsonb),public.person_storage_paths(uuid),public.mark_storage_deleted(text[]) from public,anon,authenticated;
grant execute on function public.save_settings(jsonb,bigint),public.prepare_import_batch(uuid,text,text,integer),public.import_lead_row(uuid,integer,text,jsonb),public.person_storage_paths(uuid),public.mark_storage_deleted(text[]) to authenticated;
revoke all on function public.link_storage_redaction() from public,anon,authenticated;

create function public.import_lead_rows(p_batch_id uuid,p_rows jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare row_input jsonb; results jsonb:='[]'; row_result jsonb;
begin
  if not public.has_role(array['owner']) then raise exception 'Owner access required' using errcode='42501'; end if;
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 100 then raise exception 'Import at most 100 rows per transaction' using errcode='22023'; end if;
  for row_input in select value from jsonb_array_elements(p_rows) loop
    begin
      row_result:=public.import_lead_row(p_batch_id,(row_input->>'row')::integer,row_input->>'hash',row_input->'input');
    exception when others then
      row_result:=jsonb_build_object('row',row_input->'row','error',sqlstate);
    end;
    results:=results||jsonb_build_array(row_result);
  end loop;
  return results;
end $$;
revoke all on function public.import_lead_rows(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.import_lead_rows(uuid,jsonb) to authenticated;

-- Existing signed downloads expire after 60 seconds; fresh links require live,
-- authorised file metadata. A soft-deleted financial file is not exposed to staff.
drop policy crm_file_read on storage.objects;
create policy crm_file_read on storage.objects for select to authenticated using(
  bucket_id='crm-files' and exists(select 1 from public.files f where f.path=storage.objects.name and
    (public.has_role(array['owner']) or (f.deleted_at is null and f.path like f.entity||'/'||f.entity_id::text||'/%' and
      ((f.upload_status='ready' and public.has_role(array['viewer'])) or
       (public.has_role(array['staff']) and f.entity not in ('quote','invoice') and
         (f.upload_status='ready' or (f.upload_status='pending' and f.uploaded_by=public.current_profile_id())))))))
);
drop policy crm_file_insert on storage.objects;
create policy crm_file_insert on storage.objects for insert to authenticated with check(
  bucket_id='crm-files' and (public.has_role(array['owner']) or (public.has_role(array['staff']) and exists(
    select 1 from public.files f where f.path=storage.objects.name and f.entity not in ('quote','invoice') and
      f.path like f.entity||'/'||f.entity_id::text||'/%' and f.deleted_at is null and f.upload_status='pending' and f.uploaded_by=public.current_profile_id()
  )))
);

-- Direct signed uploads bypass Vercel's 4.5 MB function payload limit.
create function public.cancel_file_upload(p_file_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare pending public.files;
begin
  if not public.has_role(array['owner','staff']) then raise exception 'Forbidden' using errcode='42501'; end if;
  select * into pending from public.files where id=p_file_id and upload_status='pending'
    and (uploaded_by=public.current_profile_id() or public.has_role(array['owner'])) for update;
  if pending.id is null then return; end if;
  -- Upload tokens last up to two hours. Schedule a second cleanup after expiry
  -- even when the HTTP handler already removed the current object successfully.
  insert into public.storage_deletions(bucket,path,delete_after) values('crm-files',pending.path,greatest(now(),pending.created_at+interval '3 hours'))
    on conflict(path) do update set done_at=null,delete_after=greatest(public.storage_deletions.delete_after,excluded.delete_after);
  update public.files set upload_status='failed',deleted_at=now() where id=p_file_id and upload_status='pending'
    and (uploaded_by=public.current_profile_id() or public.has_role(array['owner']));
end $$;
create policy crm_pending_upload_cleanup on storage.objects for delete to authenticated using(
  bucket_id='crm-files' and public.has_role(array['staff']) and exists(select 1 from public.files f where f.path=storage.objects.name and f.upload_status='pending' and f.uploaded_by=public.current_profile_id())
);
create function public.reap_pending_uploads() returns integer language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
  if not public.is_service() then raise exception 'Service only' using errcode='42501'; end if;
  insert into public.storage_deletions(bucket,path) select 'crm-files',path from public.files where upload_status='pending' and created_at<now()-interval '3 hours' on conflict(path) do nothing;
  update public.files set upload_status='failed',deleted_at=now() where upload_status='pending' and created_at<now()-interval '3 hours';
  get diagnostics affected=row_count;return affected;
end $$;
insert into storage.buckets(id,name,public,file_size_limit) values('crm-exports','crm-exports',false,52428800) on conflict(id) do nothing;
create policy crm_export_owner_read on storage.objects for select to authenticated using(bucket_id='crm-exports' and public.has_role(array['owner']));
create policy crm_export_owner_insert on storage.objects for insert to authenticated with check(bucket_id='crm-exports' and public.has_role(array['owner']));
create policy crm_export_owner_delete on storage.objects for delete to authenticated using(bucket_id='crm-exports' and public.has_role(array['owner']));
create function public.queue_export_cleanup(p_path text) returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.has_role(array['owner']) then raise exception 'Owner access required' using errcode='42501'; end if;
  if p_path not like public.current_profile_id()::text||'/%' or length(p_path)>300 then raise exception 'Invalid export path' using errcode='22023'; end if;
  insert into public.storage_deletions(bucket,path,delete_after) values('crm-exports',p_path,now()+interval '1 hour') on conflict(path) do nothing;
end $$;
create policy anonymous_deal_report_read on public.deals for select to authenticated using(anonymised_at is not null and public.has_role(array['viewer']));
create policy anonymous_business_report_read on public.businesses for select to authenticated using(anonymised_at is not null and public.has_role(array['viewer']));
create policy anonymous_contact_report_read on public.contacts for select to authenticated using(anonymised_at is not null and public.has_role(array['viewer']));
revoke all on function public.cancel_file_upload(uuid),public.reap_pending_uploads(),public.queue_export_cleanup(text) from public,anon,authenticated;
grant execute on function public.cancel_file_upload(uuid),public.queue_export_cleanup(text) to authenticated;
grant execute on function public.reap_pending_uploads() to service_role;

-- Resolve the whole person's graph, including delivery/billing records linked
-- only through a business. Never redact a business still used by another person.
create function public.contact_redaction_scope(p_contact_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare c public.contacts; scoped_deals uuid[]; scoped_businesses uuid[]; scoped_projects uuid[]; scoped_quotes uuid[]; scoped_invoices uuid[]; scoped_subscriptions uuid[];
begin
  select * into c from public.contacts where id=p_contact_id;
  if c.id is null then raise exception 'Contact not found' using errcode='P0002'; end if;
  select coalesce(array_agg(id),'{}') into scoped_deals from public.deals where contact_id=c.id;
  select coalesce(array_agg(b.id),'{}') into scoped_businesses from public.businesses b
    where (b.id=c.business_id or b.id in (select business_id from public.deals where id=any(scoped_deals)))
      and not exists(select 1 from public.contacts other where other.business_id=b.id and other.id<>c.id and other.anonymised_at is null)
      and not exists(select 1 from public.deals d join public.contacts other on other.id=d.contact_id where d.business_id=b.id and other.id<>c.id and other.anonymised_at is null);
  select coalesce(array_agg(id),'{}') into scoped_projects from public.projects where deal_id=any(scoped_deals) or business_id=any(scoped_businesses);
  select coalesce(array_agg(id),'{}') into scoped_quotes from public.quotes where deal_id=any(scoped_deals);
  select coalesce(array_agg(id),'{}') into scoped_subscriptions from public.subscriptions where business_id=any(scoped_businesses);
  select coalesce(array_agg(id),'{}') into scoped_invoices from public.invoices
    where contact_id=c.id or deal_id=any(scoped_deals) or project_id=any(scoped_projects) or quote_id=any(scoped_quotes) or business_id=any(scoped_businesses) or subscription_id=any(scoped_subscriptions);
  return jsonb_build_object('deals',scoped_deals,'businesses',scoped_businesses,'projects',scoped_projects,'quotes',scoped_quotes,'invoices',scoped_invoices,'subscriptions',scoped_subscriptions);
end $$;
revoke all on function public.contact_redaction_scope(uuid) from public,anon,authenticated,service_role;
create function public.person_data_scope(p_contact_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.has_role(array['owner']) then raise exception 'Owner access required' using errcode='42501'; end if;
  return public.contact_redaction_scope(p_contact_id);
end $$;
revoke all on function public.person_data_scope(uuid) from public,anon,authenticated;
grant execute on function public.person_data_scope(uuid) to authenticated;

create or replace function public.anonymise_contact(p_contact_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare c public.contacts; scope jsonb; deal_ids uuid[]; business_ids uuid[]; project_ids uuid[]; quote_ids uuid[]; invoice_ids uuid[];
  subscription_ids uuid[]; file_ids uuid[]; tag_ids uuid[]; entity_ids uuid[];
begin
  if not public.has_role(array['owner']) and not public.is_service() then raise exception 'Owner only' using errcode='42501'; end if;
  select * into c from public.contacts where id=p_contact_id for update;
  if c.id is null then raise exception 'Contact not found' using errcode='P0002'; end if;
  -- Repeating the action also repairs any old records created before this wider
  -- redaction scope, without changing anonymous cohort or financial facts.
  scope:=public.contact_redaction_scope(c.id);
  deal_ids:=array(select jsonb_array_elements_text(scope->'deals')::uuid);
  business_ids:=array(select jsonb_array_elements_text(scope->'businesses')::uuid);
  project_ids:=array(select jsonb_array_elements_text(scope->'projects')::uuid);
  quote_ids:=array(select jsonb_array_elements_text(scope->'quotes')::uuid);
  invoice_ids:=array(select jsonb_array_elements_text(scope->'invoices')::uuid);
  subscription_ids:=array(select jsonb_array_elements_text(scope->'subscriptions')::uuid);
  entity_ids:=array[c.id]||deal_ids||business_ids||project_ids||quote_ids||invoice_ids||subscription_ids;
  perform set_config('lumen.anonymising_contact',p_contact_id::text,true);
  select coalesce(array_agg(id),'{}') into file_ids from public.files where
    (entity='contact' and entity_id=c.id) or (entity='deal' and entity_id=any(deal_ids)) or
    (entity='business' and entity_id=any(business_ids)) or (entity='project' and entity_id=any(project_ids)) or
    (entity='quote' and entity_id=any(quote_ids)) or (entity='invoice' and entity_id=any(invoice_ids));
  insert into public.storage_deletions(path,contact_id)
    select path,c.id from public.files where id=any(file_ids) and path not like 'deleted/%'
    on conflict(path) do update set contact_id=coalesce(public.storage_deletions.contact_id,excluded.contact_id);
  update public.files set name='Removed file',path='deleted/'||id,deleted_at=coalesce(deleted_at,now()) where id=any(file_ids);
  update public.contacts set first_name='Deleted person',last_name='',role_title=null,phone_e164=null,phone_display=null,email=null,best_time=null,
    do_not_contact=true,anonymised_at=coalesce(anonymised_at,now()),deleted_at=coalesce(deleted_at,now()) where id=c.id;
  update public.deals set title='Anonymised enquiry',lost_reason=null,promised_text=null,next_step=null,next_step_at=null,chloe_fields='{}',
    anonymised_at=coalesce(anonymised_at,now()),deleted_at=coalesce(deleted_at,now()) where id=any(deal_ids);
  update public.attribution set form_source=null,page_url=null,landing_url=null,referrer=null,landing_referrer=null,event_id=null,fbp=null,fbc=null,
    meta_lead_id=null,meta_form_name=null,raw='{}' where deal_id=any(deal_ids);
  update public.activities set body=null,meta='{}' where contact_id=c.id or deal_id=any(deal_ids)
    or meta->>'invoice_id'=any(array(select unnest(invoice_ids)::text)) or meta->>'project_id'=any(array(select unnest(project_ids)::text));
  update public.tasks set title='Archived task',notes=null,rule_key=null,done_at=coalesce(done_at,now())
    where contact_id=c.id or deal_id=any(deal_ids) or project_id=any(project_ids)
      or rule_key=any(array(select 'invoice_overdue:'||unnest(invoice_ids)::text));
  update public.appointments set notes=null,ics_uid=id::text||'@crm.lumenadl.com',status=case when status='booked' then 'cancelled' else status end where contact_id=c.id or deal_id=any(deal_ids);
  update public.demos set url=null,notes=null where deal_id=any(deal_ids);
  -- included_details lives within the frozen terms_snapshot.items array.
  update public.quotes set accepted_name=null,accepted_ip=null,accepted_user_agent=null,notes=null,terms_url=null,terms_snapshot='{}',
    status=case when status in ('draft','sent','viewed') then 'expired' else status end where id=any(quote_ids);
  update public.quote_items set description='Archived item' where quote_id=any(quote_ids);
  update public.projects set name='Anonymised project',site_url=null,feature_permission_note=null,template_key='archived' where id=any(project_ids);
  update public.checklist_items set title='Archived checklist item',section='Archived' where project_id=any(project_ids);
  update public.subscriptions set status_reason=null where id=any(subscription_ids);
  update public.invoices set notes=null,gst_wording=null,billing_snapshot='{}' where id=any(invoice_ids);
  update public.invoice_items set description='Archived item' where invoice_id=any(invoice_ids);
  update public.payments set reference=null,method=case when method in ('bank_transfer','cash','card','other') then method else 'other' end where invoice_id=any(invoice_ids);
  update public.message_drafts set body='Removed',subject=null,rule_key=null,status='cancelled' where contact_id=c.id or deal_id=any(deal_ids) or invoice_id=any(invoice_ids);
  update public.consents set evidence=null,source='anonymised' where contact_id=c.id;
  update public.capi_outbox set payload='{"redacted":true}',status='skipped',last_error='contact_anonymised' where deal_id=any(deal_ids);
  update public.integration_inbox set error=null where deal_id=any(deal_ids);
  update public.notifications_log set error=null,status=case when status in ('pending','processing','failed') then 'skipped' else status end where entity_id=any(entity_ids);
  update public.job_runs set error=null,status='done',finished_at=coalesce(finished_at,now()),locked_at=null where entity_id=any(entity_ids);
  select coalesce(array_agg(distinct tag_id),'{}') into tag_ids from public.taggings where entity_id=any(entity_ids||file_ids);
  delete from public.taggings where entity_id=any(entity_ids||file_ids);
  update public.tags set name='Archived tag '||id,deleted_at=coalesce(deleted_at,now()) where id=any(tag_ids) and not exists(select 1 from public.taggings where tag_id=public.tags.id);
  update public.businesses set name='Anonymised business',abn=null,website_url=null,google_business_url=null,suburb=null,postcode=null,
    service_areas='{}',notes=null,anonymised_at=coalesce(anonymised_at,now()),deleted_at=coalesce(deleted_at,now()) where id=any(business_ids);
  perform set_config('lumen.anonymising_contact','',true);
end $$;

create or replace function public.person_storage_paths(p_contact_id uuid) returns text[] language plpgsql security definer set search_path='' as $$
declare scope jsonb; paths text[];
begin
  if not public.has_role(array['owner']) then raise exception 'Owner access required' using errcode='42501'; end if;
  scope:=public.contact_redaction_scope(p_contact_id);
  select coalesce(array_agg(distinct path),'{}') into paths from (
    select f.path from public.files f where (f.entity='contact' and f.entity_id=p_contact_id)
      or (f.entity='deal' and f.entity_id::text in (select jsonb_array_elements_text(scope->'deals')))
      or (f.entity='business' and f.entity_id::text in (select jsonb_array_elements_text(scope->'businesses')))
      or (f.entity='project' and f.entity_id::text in (select jsonb_array_elements_text(scope->'projects')))
      or (f.entity='quote' and f.entity_id::text in (select jsonb_array_elements_text(scope->'quotes')))
      or (f.entity='invoice' and f.entity_id::text in (select jsonb_array_elements_text(scope->'invoices')))
    union select path from public.storage_deletions where contact_id=p_contact_id and done_at is null
  ) all_paths where path not like 'deleted/%';
  return paths;
end $$;
