create function public.claim_job(p_key text,p_kind text,p_entity_id uuid default null,p_lease_seconds integer default 300) returns boolean language plpgsql security definer set search_path='' as $$
declare claimed uuid;
begin
  if not public.is_service() then raise exception 'Service only' using errcode='42501'; end if;
  if length(p_key)>300 or p_lease_seconds<30 or p_lease_seconds>3600 then raise exception 'Invalid lease' using errcode='22023'; end if;
  insert into public.job_runs(key,kind,entity_id,status,attempts,locked_at)
    values(p_key,p_kind,p_entity_id,'running',1,now())
  on conflict(key) do update set status='running',attempts=public.job_runs.attempts+1,locked_at=now(),error=null
    where public.job_runs.status in ('pending','failed') or (public.job_runs.status='running' and public.job_runs.locked_at<now()-make_interval(secs=>p_lease_seconds))
  returning id into claimed;
  return claimed is not null;
end $$;
create function public.finish_job(p_key text,p_status text,p_error text default null) returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_service() then raise exception 'Service only' using errcode='42501'; end if;
  if p_status not in ('done','failed') then raise exception 'Invalid job result' using errcode='22023'; end if;
  update public.job_runs set status=p_status,finished_at=now(),locked_at=null,error=left(p_error,100) where key=p_key and status='running';
end $$;
create function public.ensure_task(p_input jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare found_id uuid; deal uuid:=nullif(p_input->>'deal_id','')::uuid; rule text:=p_input->>'rule_key';
begin
  if not public.is_service() then raise exception 'Service only' using errcode='42501'; end if;
  if nullif(rule,'') is null or length(rule)>300 then raise exception 'Rule key required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtext('task:'||coalesce(deal::text,'')||':'||rule));
  select id into found_id from public.tasks where deal_id is not distinct from deal and rule_key=rule and deleted_at is null limit 1;
  if found_id is not null then return found_id; end if;
  insert into public.tasks(deal_id,contact_id,project_id,title,notes,due_at,remind_at,priority,rule_key)
    values(deal,nullif(p_input->>'contact_id','')::uuid,nullif(p_input->>'project_id','')::uuid,p_input->>'title',p_input->>'notes',
      nullif(p_input->>'due_at','')::timestamptz,nullif(p_input->>'remind_at','')::timestamptz,coalesce(p_input->>'priority','normal'),rule) returning id into found_id;
  return found_id;
end $$;
create function public.backup_table_names() returns text[] language sql security definer set search_path='' as $$
  select coalesce(array_agg(tablename::text order by tablename),'{}') from pg_tables where schemaname='public' and public.is_service()
$$;
create function public.capi_candidates(p_limit integer default 100) returns setof jsonb language sql security definer set search_path='' as $$
  select jsonb_build_object('deal_id',d.id,'contact_id',d.contact_id,'milestone',m.milestone_key,'reached_at',m.first_reached_at,
    'event_name',s.config#>>array['capi','mapping',m.milestone_key],'value_once',d.value_once,
    'contact',jsonb_build_object('first_name',c.first_name,'last_name',c.last_name,'email',c.email,'phone_e164',c.phone_e164),
    'attribution',jsonb_build_object('meta_lead_id',a.meta_lead_id,'fbp',a.fbp,'fbc',a.fbc))
  from public.deal_milestones m join public.deals d on d.id=m.deal_id join public.contacts c on c.id=d.contact_id
  cross join public.settings s left join public.attribution a on a.deal_id=d.id
  left join public.capi_outbox o on o.event_id='crm:'||d.id||':'||m.milestone_key
  where public.is_service() and s.singleton and coalesce((s.config#>>'{capi,enabled}')::boolean,false)
    and nullif(s.config#>>array['capi','mapping',m.milestone_key],'') is not null
    and lower(s.config#>>array['capi','mapping',m.milestone_key]) <> 'lead'
    and d.merged_into_id is null and d.deleted_at is null and c.anonymised_at is null and o.id is null
  order by m.first_reached_at limit greatest(1,least(p_limit,500))
$$;
create function public.claim_capi(p_limit integer default 20) returns setof public.capi_outbox language plpgsql security definer set search_path='' as $$
begin
  if not public.is_service() then raise exception 'Service only' using errcode='42501'; end if;
  if not exists(select 1 from public.settings where singleton and coalesce((config#>>'{capi,enabled}')::boolean,false)) then return; end if;
  return query update public.capi_outbox o set status='processing',attempts=o.attempts+1,locked_at=now()
    where o.id in (select q.id from public.capi_outbox q where q.next_attempt_at<=now()
      and (q.status in ('pending','failed') or (q.status='processing' and q.locked_at<now()-interval '10 minutes'))
      order by q.next_attempt_at for update skip locked limit greatest(1,least(p_limit,50))) returning o.*;
end $$;

create table public.storage_deletions (
  id uuid primary key default gen_random_uuid(),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  bucket text not null default 'crm-files',path text not null unique,attempts integer not null default 0,done_at timestamptz,error text
);
alter table public.storage_deletions enable row level security;
revoke all on public.storage_deletions from anon,authenticated;
grant all on public.storage_deletions to service_role;
create trigger touch_updated_at before update on public.storage_deletions for each row execute function public.touch_updated_at();

create function public.anonymise_contact(p_contact_id uuid) returns void language plpgsql security definer set search_path='' as $$
declare c public.contacts; deal_ids uuid[]; project_ids uuid[]; quote_ids uuid[]; invoice_ids uuid[]; private_business boolean;
begin
  if not public.has_role(array['owner']) and not public.is_service() then raise exception 'Owner only' using errcode='42501'; end if;
  select * into c from public.contacts where id=p_contact_id for update;
  if c.id is null then raise exception 'Contact not found' using errcode='P0002'; end if;
  if c.anonymised_at is not null then return; end if;
  perform set_config('lumen.anonymising_contact',p_contact_id::text,true);
  select coalesce(array_agg(id),'{}') into deal_ids from public.deals where contact_id=c.id;
  select coalesce(array_agg(id),'{}') into project_ids from public.projects where deal_id=any(deal_ids);
  select coalesce(array_agg(id),'{}') into quote_ids from public.quotes where deal_id=any(deal_ids);
  select coalesce(array_agg(id),'{}') into invoice_ids from public.invoices where contact_id=c.id or deal_id=any(deal_ids);
  private_business:=c.business_id is not null and not exists(select 1 from public.contacts where business_id=c.business_id and id<>c.id and anonymised_at is null);
  insert into public.storage_deletions(path)
    select path from public.files where (entity='contact' and entity_id=c.id) or (entity='deal' and entity_id=any(deal_ids))
    or (entity='project' and entity_id=any(project_ids)) or (entity='quote' and entity_id=any(quote_ids)) or (entity='invoice' and entity_id=any(invoice_ids))
    or (entity='business' and entity_id=c.business_id and private_business) on conflict(path) do nothing;
  update public.files set name='Removed file',path='deleted/'||id,deleted_at=now() where path in (select path from public.storage_deletions where done_at is null);
  update public.contacts set first_name='Deleted person',last_name='',role_title=null,phone_e164=null,phone_display=null,email=null,best_time=null,
    do_not_contact=true,anonymised_at=now(),deleted_at=coalesce(deleted_at,now()) where id=c.id;
  update public.deals set title='Anonymised enquiry',lost_reason=null,promised_text=null,next_step=null,next_step_at=null,chloe_fields='{}',deleted_at=coalesce(deleted_at,now()) where id=any(deal_ids);
  update public.attribution set form_source=null,page_url=null,landing_url=null,referrer=null,landing_referrer=null,event_id=null,fbp=null,fbc=null,meta_lead_id=null,meta_form_name=null,raw='{}' where deal_id=any(deal_ids);
  update public.activities set body=null,meta='{}' where contact_id=c.id or deal_id=any(deal_ids);
  update public.tasks set title='Archived task',notes=null,done_at=coalesce(done_at,now()) where contact_id=c.id or deal_id=any(deal_ids);
  update public.appointments set notes=null,status=case when status='booked' then 'cancelled' else status end where contact_id=c.id or deal_id=any(deal_ids);
  update public.demos set url=null,notes=null where deal_id=any(deal_ids);
  update public.quotes set accepted_name=null,accepted_ip=null,accepted_user_agent=null,notes=null,terms_snapshot='{}',status=case when status in ('draft','sent','viewed') then 'expired' else status end where id=any(quote_ids);
  update public.quote_items set description='Archived item' where quote_id=any(quote_ids);
  update public.projects set name='Anonymised project',site_url=null,feature_permission_note=null where id=any(project_ids);
  update public.checklist_items set title='Archived checklist item' where project_id=any(project_ids);
  update public.invoices set notes=null,billing_snapshot='{}' where id=any(invoice_ids);
  update public.invoice_items set description='Archived item' where invoice_id=any(invoice_ids);
  update public.payments set reference=null where invoice_id=any(invoice_ids);
  update public.message_drafts set body='Removed',subject=null,status='cancelled' where contact_id=c.id or deal_id=any(deal_ids);
  update public.consents set evidence=null,source='anonymised' where contact_id=c.id;
  update public.capi_outbox set payload='{"redacted":true}',status='skipped',last_error='contact_anonymised' where deal_id=any(deal_ids);
  if private_business then
    update public.businesses set name='Anonymised business',abn=null,website_url=null,google_business_url=null,suburb=null,postcode=null,service_areas='{}',notes=null,deleted_at=coalesce(deleted_at,now()) where id=c.business_id;
  end if;
  perform set_config('lumen.anonymising_contact','',true);
end $$;

create function public.purge_bin(p_before timestamptz) returns integer language plpgsql security definer set search_path='' as $$
declare c record; affected integer:=0;
begin
  if not public.is_service() then raise exception 'Service only' using errcode='42501'; end if;
  if p_before>now()-interval '30 days' then raise exception 'The bin keeps records for at least 30 days' using errcode='22023'; end if;
  for c in select id from public.contacts where deleted_at<p_before and anonymised_at is null loop perform public.anonymise_contact(c.id);affected:=affected+1;end loop;
  insert into public.storage_deletions(path) select path from public.files where deleted_at<p_before and path not like 'deleted/%' on conflict(path) do nothing;
  delete from public.files where deleted_at<p_before;
  delete from public.activities where deleted_at<p_before;
  delete from public.tasks where deleted_at<p_before;
  delete from public.appointments where deleted_at<p_before;
  delete from public.checklist_items where deleted_at<p_before;
  delete from public.demos where deleted_at<p_before;
  delete from public.saved_views where deleted_at<p_before;
  delete from public.taggings where deleted_at<p_before;
  delete from public.message_drafts where deleted_at<p_before;
  delete from public.push_subscriptions where deleted_at<p_before;
  delete from public.calendar_tokens where deleted_at<p_before;
  delete from public.rate_limits where window_start<now()-interval '2 days';
  return affected;
end $$;

revoke all on function public.claim_job(text,text,uuid,integer),public.finish_job(text,text,text),public.ensure_task(jsonb),public.backup_table_names(),public.capi_candidates(integer),public.claim_capi(integer),public.purge_bin(timestamptz),public.anonymise_contact(uuid) from public,anon,authenticated;
grant execute on function public.claim_job(text,text,uuid,integer),public.finish_job(text,text,text),public.ensure_task(jsonb),public.backup_table_names(),public.capi_candidates(integer),public.claim_capi(integer),public.purge_bin(timestamptz),public.anonymise_contact(uuid) to service_role;
grant execute on function public.anonymise_contact(uuid) to authenticated;
