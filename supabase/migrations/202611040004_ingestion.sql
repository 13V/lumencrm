alter table public.deals add column chloe_last_event_at timestamptz;
create table public.rate_limits (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  key text not null unique, window_start timestamptz not null, count integer not null default 0
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon,authenticated;
grant all on public.rate_limits to service_role;
create trigger touch_updated_at before update on public.rate_limits for each row execute function public.touch_updated_at();
create index rate_limits_expiry_idx on public.rate_limits(window_start);

create function public.consume_rate_limit(p_key text,p_limit integer,p_window_seconds integer) returns boolean language plpgsql security definer set search_path='' as $$
declare win timestamptz; used integer;
begin
  if not public.is_service() then raise exception 'Service only' using errcode='42501'; end if;
  if p_limit < 1 or p_window_seconds < 1 or p_window_seconds > 86400 or length(p_key) > 300 then raise exception 'Invalid rate limit' using errcode='22023'; end if;
  win := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits(key,window_start,count) values(p_key,win,1)
    on conflict(key) do update set
      count=case when public.rate_limits.window_start=win then public.rate_limits.count+1 else 1 end,window_start=win
    returning count into used;
  return used <= p_limit;
end $$;

create function public.ingest_lead(p_source text,p_key text,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare idem text; existing public.integration_inbox; result jsonb; c public.contacts; attr jsonb; enriched jsonb;
begin
  if not public.is_service() then raise exception 'Service only' using errcode='42501'; end if;
  if p_source not in ('website','meta') or nullif(trim(p_key),'') is null or length(p_key)>200 then raise exception 'Invalid source or event identifier' using errcode='22023'; end if;
  idem := p_source||':'||p_key;
  perform pg_advisory_xact_lock(hashtext('ingest:'||idem));
  select * into existing from public.integration_inbox where idempotency_key=idem;
  if existing.id is not null then
    return jsonb_build_object('deal_id',existing.deal_id,'duplicate',true);
  end if;
  enriched:=p_input || jsonb_build_object('channel',case when p_source='meta' then 'meta_form' when p_input->>'channel'='business_card' then 'business_card' else 'website' end,
    'website',coalesce(p_input->>'website_url',p_input->>'website'));
  result:=public.create_lead(enriched);
  select * into c from public.contacts where id=(result->>'contact_id')::uuid;
  -- An inbound request permits replying about that request. It never overrides STOP
  -- and is not permission for unrelated marketing or bulk messages.
  if c.sms_opt_out_at is null and c.phone_e164 is not null and not c.do_not_contact then
    insert into public.consents(contact_id,channel,status,source,evidence)
      values(c.id,'sms','opt_in',p_source||'_enquiry','Inbound enquiry: permission to reply about this request only.');
  end if;
  if c.email_opt_out_at is null and c.email is not null and not c.do_not_contact then
    insert into public.consents(contact_id,channel,status,source,evidence)
      values(c.id,'email','opt_in',p_source||'_enquiry','Inbound enquiry: permission to reply about this request only.');
  end if;
  if coalesce((p_input->>'promise_needs_review')::boolean,false) then
    insert into public.tasks(deal_id,contact_id,title,notes,due_at,priority,rule_key)
      values((result->>'deal_id')::uuid,c.id,'Confirm promised date',p_input->>'promised_text',now(),'high','promise_review')
      on conflict(deal_id,rule_key) where rule_key is not null and deleted_at is null do nothing;
  end if;
  insert into public.integration_inbox(source,idempotency_key,status,deal_id,processed_at)
    values(p_source,idem,'processed',(result->>'deal_id')::uuid,now());
  insert into public.notifications_log(event_key,entity_id,channel,status)
    values('new_lead:'||(result->>'deal_id'),(result->>'deal_id')::uuid,'telegram','pending') on conflict(event_key,channel) do nothing;
  return jsonb_build_object('deal_id',result->>'deal_id','duplicate',false);
end $$;

create function public.ingest_chloe(p_key text,p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare idem text; existing public.integration_inbox; d public.deals; c public.contacts; a public.appointments;
  result jsonb; event_type text:=p_input->>'type'; event_at timestamptz:=(p_input->>'at')::timestamptz;
  phone text:=coalesce(p_input->>'phone_e164',p_input->>'phone'); state text:=nullif(p_input->>'status','');
  incoming_fields jsonb:=coalesce(p_input->'fields','{}'::jsonb); stop boolean;
  call_at timestamptz; call_duration integer; prep text; is_current boolean;
begin
  if not public.is_service() then raise exception 'Service only' using errcode='42501'; end if;
  if event_type not in ('started','message_in','message_out','fields','booked','rescheduled','cancelled','handoff','stopped','done','human')
    or phone !~ '^[+][1-9][0-9]{7,14}$' or event_at is null or nullif(p_key,'') is null then raise exception 'Invalid Chloe event' using errcode='22023'; end if;
  -- The wire contract contains the phone; storage retains only its SHA-256 key.
  idem:='chloe:'||encode(extensions.digest(case when p_key like 'chloe:%' then p_key else 'chloe:'||p_key end,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtext('ingest:'||idem));
  select * into existing from public.integration_inbox where idempotency_key=idem;
  if existing.id is not null then return jsonb_build_object('deal_id',existing.deal_id,'duplicate',true); end if;
  perform pg_advisory_xact_lock(hashtext('phone:'||phone));
  select * into c from public.contacts where phone_e164=phone and deleted_at is null for update;
  if c.id is not null then
    if nullif(p_input->>'lead_id','') is not null then
      select deals.* into d from public.deals deals join public.attribution attr on attr.deal_id=deals.id
        where attr.meta_lead_id=p_input->>'lead_id' and deals.contact_id=c.id and deals.deleted_at is null limit 1;
    end if;
    if d.id is null then
      select * into d from public.deals where contact_id=c.id and deleted_at is null order by (outcome='open') desc,created_at desc limit 1 for update;
    end if;
  end if;
  if d.id is null then
    result:=public.create_lead(jsonb_build_object('first_name',coalesce(nullif(p_input->>'first_name',''),'Unknown contact'),'phone_e164',phone,'channel','chloe','received_at',event_at,'title','SMS enquiry'));
    select * into d from public.deals where id=(result->>'deal_id')::uuid for update;
    select * into c from public.contacts where id=d.contact_id;
  end if;
  stop:=event_type='stopped' or coalesce((p_input->>'is_stop')::boolean,false)
    or (event_type='message_in' and upper(trim(coalesce(p_input->>'text',''))) ~ '^(STOP|UNSUBSCRIBE|CANCEL|END|QUIT)[.!]?$');
  is_current:=d.chloe_last_event_at is null or event_at>=d.chloe_last_event_at;
  if event_type in ('message_in','message_out') then
    insert into public.activities(deal_id,contact_id,type,direction,body,occurred_at,meta)
      values(d.id,c.id,case when event_type='message_in' then 'chloe_in'::public.activity_type else 'chloe_out'::public.activity_type end,
        case when event_type='message_in' then 'inbound' else 'outbound' end,p_input->>'text',event_at,jsonb_build_object('integration_key',idem));
    if event_type='message_out' then
      update public.deals set first_touch_at=least(coalesce(first_touch_at,event_at),event_at) where id=d.id;
    else
      update public.deals set two_way_at=least(coalesce(two_way_at,event_at),event_at),
        stage_key=case when stage_key='new' and outcome='open' and not stop then 'contacted' else stage_key end where id=d.id;
    end if;
  else
    insert into public.activities(deal_id,contact_id,type,body,occurred_at,meta)
      values(d.id,c.id,'chloe_status',coalesce(nullif(p_input->>'reason',''),'Chloe: '||event_type),event_at,jsonb_build_object('event',event_type,'integration_key',idem));
  end if;
  if is_current and incoming_fields <> '{}'::jsonb then
    update public.deals set chloe_fields=chloe_fields||incoming_fields where id=d.id;
  end if;
  state:=coalesce(state,case event_type when 'started' then 'active' when 'booked' then 'booked' when 'rescheduled' then 'booked' when 'handoff' then 'handoff' when 'human' then 'human' when 'done' then 'done' else null end);
  if state is not null and state not in ('queued','active','booked','handoff','done','stopped','human') then raise exception 'Invalid Chloe status' using errcode='22023'; end if;
  if stop then
    perform public.record_consent(c.id,'sms','opt_out','chloe',coalesce(nullif(p_input->>'text',''),'STOP received'));
    update public.deals set chloe_status='stopped' where id=d.id;
  elsif is_current and state is not null then
    update public.deals set chloe_status=case when chloe_status='stopped' then 'stopped' else state end where id=d.id;
  end if;
  if is_current and event_type in ('booked','rescheduled') then
    call_at:=nullif(p_input->>'call_time','')::timestamptz;
    if call_at is null then raise exception 'call_time is required for bookings' using errcode='22023'; end if;
    select coalesce((config#>>'{call_hours,call_duration_minutes}')::integer,15) into call_duration from public.settings where singleton;
    select string_agg(initcap(replace(key,'_',' '))||': '||value,E'\n') into prep from jsonb_each_text(d.chloe_fields||incoming_fields);
    select * into a from public.appointments where deal_id=d.id and source='chloe' and status='booked' and deleted_at is null order by created_at desc limit 1 for update;
    if a.id is null then
      insert into public.appointments(deal_id,contact_id,kind,starts_at,ends_at,source,notes)
        values(d.id,c.id,'call',call_at,call_at+make_interval(mins=>call_duration),'chloe',prep) returning * into a;
    else
      update public.appointments set starts_at=call_at,ends_at=call_at+make_interval(mins=>call_duration),notes=prep,status='booked' where id=a.id returning * into a;
    end if;
    if d.outcome='open' then update public.deals set stage_key='call_booked',next_step='Call '||c.first_name,next_step_at=call_at where id=d.id; end if;
    if exists(select 1 from public.automations where key='call_booked' and enabled) then
      insert into public.tasks(deal_id,contact_id,title,notes,due_at,remind_at,rule_key)
        values(d.id,c.id,'Prepare for call with '||c.first_name,prep,call_at-interval '15 minutes',call_at-interval '15 minutes','call_prep')
        on conflict(deal_id,rule_key) where rule_key is not null and deleted_at is null
        do update set due_at=excluded.due_at,remind_at=excluded.remind_at,notes=excluded.notes,done_at=null;
    end if;
  elsif is_current and event_type='cancelled' then
    update public.appointments set status='cancelled' where deal_id=d.id and source='chloe' and status='booked' and deleted_at is null;
    update public.tasks set done_at=now() where deal_id=d.id and rule_key='call_prep' and done_at is null;
    update public.deals set next_step='Arrange another call',next_step_at=now() where id=d.id and outcome='open';
  end if;
  update public.deals set chloe_last_event_at=greatest(coalesce(chloe_last_event_at,event_at),event_at) where id=d.id;
  insert into public.integration_inbox(source,idempotency_key,status,deal_id,processed_at) values('chloe',idem,'processed',d.id,now());
  if event_type in ('booked','rescheduled','handoff','message_in') then
    insert into public.notifications_log(event_key,entity_id,channel,status)
      values('chloe:'||encode(extensions.digest(idem,'sha256'),'hex'),d.id,'telegram','pending') on conflict(event_key,channel) do nothing;
  end if;
  if event_type='message_in' and (d.chloe_status='human' or d.chloe_status is null) then
    insert into public.job_runs(key,kind,entity_id) values('reply:'||encode(extensions.digest(idem,'sha256'),'hex'),'human_reply',d.id) on conflict(key) do nothing;
  end if;
  return jsonb_build_object('deal_id',d.id,'duplicate',false);
end $$;

-- Reserve the send id before invoking the provider. A duplicate never sends twice.
-- An interrupted/ambiguous provider request stays pending for an owner to reconcile.
create unique index activities_message_request_idx on public.activities((meta->>'request_id')) where meta ? 'request_id';
create function public.prepare_message(p_deal_id uuid,p_channel text,p_body text,p_subject text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.deals; c public.contacts; a public.activities; last_consent text;
begin
  if not public.has_role(array['owner','staff']) then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_channel not in ('sms','email') or nullif(trim(p_body),'') is null or length(p_body)>10000 then raise exception 'Invalid message' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtext('send:'||p_request_id));
  select * into a from public.activities where meta->>'request_id'=p_request_id::text;
  if found then
    if a.deal_id<>p_deal_id then raise exception 'Request identifier already used' using errcode='23514'; end if;
    return jsonb_build_object('activity_id',a.id,'duplicate',true);
  end if;
  select * into d from public.deals where id=p_deal_id and deleted_at is null;
  if not found then raise exception 'Deal not found' using errcode='P0002'; end if;
  select * into c from public.contacts where id=d.contact_id and deleted_at is null for update;
  if c.id is null or c.do_not_contact or (p_channel='sms' and c.sms_opt_out_at is not null) or (p_channel='email' and c.email_opt_out_at is not null) then
    raise exception 'This contact has opted out. Sending is blocked.' using errcode='23514';
  end if;
  if (p_channel='sms' and c.phone_e164 is null) or (p_channel='email' and c.email is null) then raise exception 'Contact address is missing' using errcode='23514'; end if;
  select status into last_consent from public.consents where contact_id=c.id and channel=p_channel order by at desc,created_at desc limit 1;
  if last_consent is distinct from 'opt_in' then raise exception 'Record consent before sending' using errcode='23514'; end if;
  insert into public.activities(deal_id,contact_id,created_by,type,direction,body,meta)
    values(d.id,c.id,public.current_profile_id(),case when p_channel='sms' then 'sms_out'::public.activity_type else 'email_out'::public.activity_type end,'outbound',p_body,
      jsonb_build_object('request_id',p_request_id,'delivery_status','pending','subject',p_subject)) returning * into a;
  return jsonb_build_object('activity_id',a.id,'duplicate',false,'contact_id',c.id,'phone_e164',c.phone_e164,'email',c.email);
end $$;
create function public.finalise_message(p_activity_id uuid,p_status text,p_provider_id text default null) returns void language plpgsql security definer set search_path='' as $$
declare a public.activities;
begin
  if not public.has_role(array['owner','staff']) then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_status not in ('queued','sent','failed','unknown','delivered') then raise exception 'Invalid delivery status' using errcode='22023'; end if;
  select * into a from public.activities where id=p_activity_id and type in ('sms_out','email_out') and meta ? 'request_id' for update;
  if a.id is null then raise exception 'Message not found' using errcode='P0002'; end if;
  if a.meta ? 'invoice_id' and not public.has_role(array['owner']) then raise exception 'Owner access required' using errcode='42501'; end if;
  update public.activities set meta=meta||jsonb_build_object('delivery_status',p_status,'provider_id',p_provider_id) where id=a.id;
  if p_status in ('queued','sent','delivered') then
    update public.deals set first_touch_at=coalesce(first_touch_at,a.occurred_at) where id=a.deal_id;
    update public.tasks set done_at=now() where deal_id=a.deal_id and rule_key='new_lead' and done_at is null;
  end if;
end $$;
revoke all on function public.consume_rate_limit(text,integer,integer),public.ingest_lead(text,text,jsonb),public.ingest_chloe(text,jsonb),public.prepare_message(uuid,text,text,text,uuid),public.finalise_message(uuid,text,text) from public,anon,authenticated;
grant execute on function public.consume_rate_limit(text,integer,integer),public.ingest_lead(text,text,jsonb),public.ingest_chloe(text,jsonb) to service_role;
grant execute on function public.prepare_message(uuid,text,text,text,uuid),public.finalise_message(uuid,text,text) to authenticated;

create function public.patch_deal(p_deal_id uuid,p_patch jsonb,p_override_reason text default null) returns public.deals language plpgsql security definer set search_path='' as $$
declare d public.deals;
begin
  if not public.has_role(array['owner','staff']) then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_override_reason is not null and not public.has_role(array['owner']) then raise exception 'Only an owner can override quote acceptance' using errcode='42501'; end if;
  if jsonb_typeof(p_patch)<>'object' or exists(select 1 from jsonb_object_keys(p_patch) key where key not in
    ('title','stage_key','outcome','lost_reason','next_step','next_step_at','promised_text','promised_due_at','value_once','value_monthly','presales_minutes','demo_build_minutes','owner_id','product_id')) then
    raise exception 'This change contains unsupported fields' using errcode='22023';
  end if;
  perform set_config('lumen.stage_override_reason',coalesce(p_override_reason,''),true);
  update public.deals set
    title=case when p_patch ? 'title' then p_patch->>'title' else title end,
    stage_key=case when p_patch ? 'stage_key' then p_patch->>'stage_key' else stage_key end,
    outcome=case when p_patch ? 'outcome' then (p_patch->>'outcome')::public.deal_outcome else outcome end,
    lost_reason=case when p_patch ? 'lost_reason' then p_patch->>'lost_reason' else lost_reason end,
    next_step=case when p_patch ? 'next_step' then p_patch->>'next_step' else next_step end,
    next_step_at=case when p_patch ? 'next_step_at' then nullif(p_patch->>'next_step_at','')::timestamptz else next_step_at end,
    promised_text=case when p_patch ? 'promised_text' then p_patch->>'promised_text' else promised_text end,
    promised_due_at=case when p_patch ? 'promised_due_at' then nullif(p_patch->>'promised_due_at','')::timestamptz else promised_due_at end,
    value_once=case when p_patch ? 'value_once' then (p_patch->>'value_once')::numeric else value_once end,
    value_monthly=case when p_patch ? 'value_monthly' then (p_patch->>'value_monthly')::numeric else value_monthly end,
    presales_minutes=case when p_patch ? 'presales_minutes' then (p_patch->>'presales_minutes')::integer else presales_minutes end,
    demo_build_minutes=case when p_patch ? 'demo_build_minutes' then (p_patch->>'demo_build_minutes')::integer else demo_build_minutes end,
    owner_id=case when p_patch ? 'owner_id' then nullif(p_patch->>'owner_id','')::uuid else owner_id end,
    product_id=case when p_patch ? 'product_id' then nullif(p_patch->>'product_id','')::uuid else product_id end
    where id=p_deal_id and deleted_at is null returning * into d;
  perform set_config('lumen.stage_override_reason','',true);
  if d.id is null then raise exception 'Deal not found' using errcode='P0002'; end if;
  return d;
end $$;

create function public.merge_deals(p_keep_id uuid,p_merge_id uuid) returns public.deals language plpgsql security definer set search_path='' as $$
declare kept public.deals; merged public.deals; keep_attr public.attribution; merge_attr public.attribution; relation_name text; rec record;
begin
  if not public.has_role(array['owner']) then raise exception 'Only an owner can merge deals' using errcode='42501'; end if;
  if p_keep_id=p_merge_id then raise exception 'Choose two different deals' using errcode='22023'; end if;
  perform id from public.deals where id in (p_keep_id,p_merge_id) order by id for update;
  select * into kept from public.deals where id=p_keep_id and deleted_at is null;
  select * into merged from public.deals where id=p_merge_id and deleted_at is null;
  if kept.id is null or merged.id is null then raise exception 'Deal not found' using errcode='P0002'; end if;
  if exists(select 1 from public.projects where deal_id=p_keep_id and deleted_at is null)
    and exists(select 1 from public.projects where deal_id=p_merge_id and deleted_at is null) then
    raise exception 'Both deals already have delivery projects. Keep these projects separate and contact support to consolidate their records.' using errcode='23514';
  end if;
  perform set_config('lumen.merging_into',p_keep_id::text,true);
  -- Timelines retain their original contact IDs, author, timing and content.
  foreach relation_name in array array['activities','tasks','appointments','demos','quotes','projects','invoices','message_drafts'] loop
    if relation_name='tasks' then
      -- Preserve tasks with a colliding automation rule as ordinary tasks.
      update public.tasks source set rule_key=null where source.deal_id=p_merge_id and source.rule_key is not null
        and exists(select 1 from public.tasks target where target.deal_id=p_keep_id and target.rule_key=source.rule_key and target.deleted_at is null);
    end if;
    execute format('update public.%I set deal_id=$1 where deal_id=$2',relation_name) using p_keep_id,p_merge_id;
  end loop;
  update public.files set entity_id=p_keep_id where entity='deal' and entity_id=p_merge_id;
  for rec in select * from public.deal_milestones where deal_id=p_merge_id loop
    insert into public.deal_milestones(deal_id,milestone_key,first_reached_at,reached_by)
      values(p_keep_id,rec.milestone_key,rec.first_reached_at,rec.reached_by)
      on conflict(deal_id,milestone_key) do update set first_reached_at=least(public.deal_milestones.first_reached_at,excluded.first_reached_at);
  end loop;
  select * into keep_attr from public.attribution where deal_id=p_keep_id;
  select * into merge_attr from public.attribution where deal_id=p_merge_id;
  if merge_attr.id is not null and (keep_attr.id is null or merge_attr.created_at<keep_attr.created_at) then
    if keep_attr.id is not null then
      insert into public.activities(deal_id,contact_id,type,body,meta)
        values(p_keep_id,kept.contact_id,'system','Additional attribution preserved during merge',jsonb_build_object('attribution',to_jsonb(keep_attr)));
      delete from public.attribution where id=keep_attr.id;
    end if;
    update public.attribution set deal_id=p_keep_id where id=merge_attr.id;
  end if;
  update public.deals set created_at=least(kept.created_at,merged.created_at),first_touch_at=least(kept.first_touch_at,merged.first_touch_at),
    two_way_at=least(kept.two_way_at,merged.two_way_at),presales_minutes=kept.presales_minutes+merged.presales_minutes,
    demo_build_minutes=kept.demo_build_minutes+merged.demo_build_minutes,"returning"=true,
    next_step=coalesce(kept.next_step,merged.next_step),next_step_at=coalesce(kept.next_step_at,merged.next_step_at)
    where id=p_keep_id returning * into kept;
  update public.deals set deleted_at=now(),merged_into_id=p_keep_id where id=p_merge_id;
  insert into public.activities(deal_id,contact_id,created_by,type,body,meta)
    values(p_keep_id,kept.contact_id,public.current_profile_id(),'system','Deal merged; both timelines retained',jsonb_build_object('merged_deal_id',p_merge_id));
  perform set_config('lumen.merging_into','',true);
  return kept;
end $$;
revoke all on function public.patch_deal(uuid,jsonb,text),public.merge_deals(uuid,uuid) from public,anon,authenticated;
grant execute on function public.patch_deal(uuid,jsonb,text),public.merge_deals(uuid,uuid) to authenticated;
