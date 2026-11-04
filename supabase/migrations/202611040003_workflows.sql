create function public.guard_deal_transition() returns trigger language plpgsql security definer set search_path = '' as $$
declare override_reason text := nullif(current_setting('lumen.stage_override_reason', true),''); valid_stage boolean;
begin
  if tg_op = 'INSERT' or new.stage_key is distinct from old.stage_key then
    select exists(select 1 from public.settings s, jsonb_array_elements(s.config->'sales_stages') stage where stage->>'key' = new.stage_key) into valid_stage;
    if not valid_stage then raise exception 'Unknown sales stage' using errcode = '23514'; end if;
    if new.stage_key = 'quote' and not exists(select 1 from public.quotes where deal_id = new.id and status in ('sent','viewed','accepted') and deleted_at is null) then
      raise exception 'Send a quote before moving to Quote sent' using errcode = '23514';
    end if;
    new.stage_entered_at := now();
    if new.stage_key = 'contacted' then new.two_way_at := coalesce(new.two_way_at,now()); end if;
    if new.stage_key = 'won' then new.outcome := 'won'; end if;
  end if;
  if new.outcome = 'won' and (tg_op = 'INSERT' or old.outcome <> 'won') then
    if not exists(select 1 from public.quotes where deal_id = new.id and status = 'accepted' and deleted_at is null)
      and (override_reason is null or length(trim(override_reason)) < 5) then
      raise exception 'An accepted quote or a recorded manual override reason is required to win a deal' using errcode = '23514';
    end if;
  end if;
  if new.outcome <> 'open' then new.closed_at := coalesce(new.closed_at,now()); else new.closed_at := null; end if;
  if tg_op = 'UPDATE' then
    -- Earliest contact times cannot be erased or moved forward by a later action.
    if old.first_touch_at is not null then new.first_touch_at := least(old.first_touch_at,coalesce(new.first_touch_at,old.first_touch_at)); end if;
    if old.two_way_at is not null then new.two_way_at := least(old.two_way_at,coalesce(new.two_way_at,old.two_way_at)); end if;
  end if;
  return new;
end $$;
create trigger guard_deal_transition before insert or update on public.deals for each row execute function public.guard_deal_transition();

create function public.record_deal_transition() returns trigger language plpgsql security definer set search_path = '' as $$
declare previous_stage text; reason text := nullif(current_setting('lumen.stage_override_reason',true),'');
begin
  previous_stage := case when tg_op = 'INSERT' then null else old.stage_key end;
  if new.stage_key is distinct from previous_stage then
    insert into public.deal_milestones(deal_id,milestone_key,first_reached_at,reached_by)
      values(new.id,new.stage_key,new.stage_entered_at,public.current_profile_id()) on conflict(deal_id,milestone_key) do nothing;
    if tg_op = 'UPDATE' then
      insert into public.activities(deal_id,contact_id,created_by,type,body,meta)
        values(new.id,new.contact_id,public.current_profile_id(),'stage_change','Sales stage changed',jsonb_build_object('from',old.stage_key,'to',new.stage_key,'override_reason',reason));
    end if;
    insert into public.job_runs(key,kind,entity_id) values('stage:'||new.id||':'||new.stage_key,'stage_automation',new.id) on conflict(key) do nothing;
  end if;
  if new.outcome = 'won' and (tg_op = 'INSERT' or old.outcome <> 'won') then
    insert into public.deal_milestones(deal_id,milestone_key,first_reached_at,reached_by)
      values(new.id,'won',coalesce(new.closed_at,now()),public.current_profile_id()) on conflict(deal_id,milestone_key) do nothing;
  end if;
  if tg_op = 'UPDATE' and new.outcome is distinct from old.outcome then
    insert into public.activities(deal_id,contact_id,created_by,type,body,meta)
      values(new.id,new.contact_id,public.current_profile_id(),'system','Outcome changed',jsonb_build_object('from',old.outcome,'to',new.outcome,'reason',new.lost_reason,'override_reason',reason));
  end if;
  return new;
end $$;
create trigger record_deal_transition after insert or update on public.deals for each row execute function public.record_deal_transition();

create function public.create_lead(p_input jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.contacts; b public.businesses; d public.deals; contact_existed boolean := false; v_first text; v_last text;
  v_phone text := nullif(trim(p_input->>'phone_e164'),''); v_email text := nullif(lower(trim(p_input->>'email')),'');
  v_business text := coalesce(nullif(trim(p_input->>'business_name'),''),nullif(trim(p_input->>'business'),''));
  v_at timestamptz := coalesce(nullif(p_input->>'received_at','')::timestamptz,now());
  attr jsonb := coalesce(p_input->'attribution','{}'::jsonb);
begin
  if not public.has_role(array['owner','staff']) and not public.is_service() then raise exception 'Forbidden' using errcode = '42501'; end if;
  v_first := coalesce(nullif(trim(p_input->>'first_name'),''),nullif(split_part(trim(p_input->>'name'),' ',1),''));
  v_last := coalesce(nullif(trim(p_input->>'last_name'),''),trim(substr(trim(p_input->>'name'),length(v_first)+1)),'');
  if v_first is null or length(v_first) > 200 then raise exception 'A name is required (maximum 200 characters)' using errcode = '22023'; end if;
  if v_phone is null and v_email is null then raise exception 'A phone number or email is required' using errcode = '22023'; end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'Phone must be normalised to E.164' using errcode = '22023'; end if;
  if v_email is not null and (length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then raise exception 'Invalid email' using errcode = '22023'; end if;
  if attr <> '{}'::jsonb and not public.is_service() then raise exception 'Attribution is written by integrations only' using errcode = '42501'; end if;
  -- Serialize only potential duplicates. Phone is always locked before email.
  if v_phone is not null then perform pg_advisory_xact_lock(hashtext('phone:'||v_phone)); end if;
  if v_email is not null then perform pg_advisory_xact_lock(hashtext('email:'||v_email)); end if;
  if v_phone is not null then select * into c from public.contacts where phone_e164 = v_phone and anonymised_at is null for update; end if;
  if c.id is null and v_email is not null then select * into c from public.contacts where lower(email) = v_email and anonymised_at is null for update; end if;
  contact_existed := c.id is not null;
  if contact_existed and c.deleted_at is not null then raise exception 'Matching contact is in the bin; restore it first' using errcode = '23514'; end if;
  if c.id is null then
    if v_business is not null then
      insert into public.businesses(name,trade,suburb,website_url) values(v_business,nullif(p_input->>'trade',''),nullif(p_input->>'suburb',''),nullif(p_input->>'website','')) returning * into b;
    end if;
    insert into public.contacts(business_id,first_name,last_name,phone_e164,phone_display,email)
      values(b.id,v_first,v_last,v_phone,coalesce(nullif(p_input->>'phone_display',''),v_phone),v_email) returning * into c;
  else
    select * into b from public.businesses where id = c.business_id;
  end if;
  select * into d from public.deals where contact_id = c.id and outcome = 'open' and deleted_at is null order by created_at asc limit 1 for update;
  if d.id is not null then
    update public.deals set "returning" = true where id = d.id returning * into d;
    insert into public.activities(deal_id,contact_id,created_by,type,body,meta,occurred_at)
      values(d.id,c.id,public.current_profile_id(),'form',coalesce(nullif(p_input->>'message',''),'Returning enquiry'),jsonb_build_object('source',p_input->>'channel','returning',true,'details',coalesce(p_input->'details','{}'::jsonb)),v_at);
    return jsonb_build_object('deal_id',d.id,'contact_id',c.id,'business_id',d.business_id,'duplicate',true);
  end if;
  insert into public.deals(contact_id,business_id,title,channel,owner_id,created_at,next_step,next_step_at,promised_text,promised_due_at,value_once,value_monthly)
    values(c.id,c.business_id,coalesce(nullif(p_input->>'title',''),nullif(p_input->>'service',''),v_business,v_first||' enquiry'),coalesce(nullif(p_input->>'channel',''),'manual'),public.current_profile_id(),v_at,
      coalesce(nullif(p_input->>'next_step',''),'Contact '||v_first),coalesce(nullif(p_input->>'next_step_at','')::timestamptz,now()),nullif(p_input->>'promised_text',''),nullif(p_input->>'promised_due_at','')::timestamptz,
      nullif(p_input->>'value_once','')::numeric,nullif(p_input->>'value_monthly','')::numeric) returning * into d;
  insert into public.activities(deal_id,contact_id,created_by,type,body,meta,occurred_at)
    values(d.id,c.id,public.current_profile_id(),'form',coalesce(nullif(p_input->>'message',''),'Enquiry received'),jsonb_build_object('source',d.channel,'details',coalesce(p_input->'details','{}'::jsonb)),v_at);
  if attr <> '{}'::jsonb then
    insert into public.attribution(deal_id,form_source,page_url,landing_url,referrer,landing_referrer,utm_source,utm_medium,utm_campaign,utm_term,utm_content,event_id,fbp,fbc,meta_lead_id,meta_form_id,meta_form_name,meta_ad_id,meta_ad_name,meta_adset_id,meta_adset_name,meta_campaign_id,meta_campaign_name,platform,is_organic,raw)
      values(d.id,attr->>'form_source',attr->>'page_url',attr->>'landing_url',attr->>'referrer',attr->>'landing_referrer',attr->>'utm_source',attr->>'utm_medium',attr->>'utm_campaign',attr->>'utm_term',attr->>'utm_content',attr->>'event_id',attr->>'fbp',attr->>'fbc',attr->>'meta_lead_id',attr->>'meta_form_id',attr->>'meta_form_name',attr->>'meta_ad_id',attr->>'meta_ad_name',attr->>'meta_adset_id',attr->>'meta_adset_name',attr->>'meta_campaign_id',attr->>'meta_campaign_name',attr->>'platform',(attr->>'is_organic')::boolean,coalesce(attr->'raw','{}'::jsonb));
  end if;
  if exists(select 1 from public.automations where key = 'new_lead' and enabled) then
    insert into public.tasks(deal_id,contact_id,title,due_at,priority,rule_key,created_by) values(d.id,c.id,'Contact '||v_first,now(),'high','new_lead',public.current_profile_id());
  end if;
  if d.promised_due_at is not null and exists(select 1 from public.automations where key = 'promise_date' and enabled) then
    insert into public.tasks(deal_id,contact_id,title,due_at,priority,rule_key) values(d.id,c.id,'Send demo and quote',d.promised_due_at,'high','promise_date');
  end if;
  insert into public.job_runs(key,kind,entity_id) values('new_lead:'||d.id,'new_lead',d.id) on conflict(key) do nothing;
  return jsonb_build_object('deal_id',d.id,'contact_id',c.id,'business_id',d.business_id,'duplicate',false);
end $$;

create function public.move_deal_stage(p_deal_id uuid,p_stage_key text,p_override_reason text default null) returns public.deals language plpgsql security definer set search_path = '' as $$
declare d public.deals;
begin
  if not public.has_role(array['owner','staff']) and not public.is_service() then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_override_reason is not null and not public.has_role(array['owner']) then raise exception 'Only an owner can override quote acceptance' using errcode = '42501'; end if;
  perform set_config('lumen.stage_override_reason',coalesce(p_override_reason,''),true);
  update public.deals set stage_key = p_stage_key where id = p_deal_id and deleted_at is null returning * into d;
  perform set_config('lumen.stage_override_reason','',true);
  if d.id is null then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  return d;
end $$;

create function public.log_call(p_deal_id uuid,p_outcome text,p_body text default '',p_next_step text default null,p_next_step_at timestamptz default null) returns public.deals language plpgsql security definer set search_path = '' as $$
declare d public.deals;
begin
  if not public.has_role(array['owner','staff']) and not public.is_service() then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_outcome not in ('reached','no_answer','voicemail','wrong_number','busy') then raise exception 'Invalid call outcome' using errcode = '22023'; end if;
  if length(coalesce(p_body,'')) > 10000 then raise exception 'Call note is too long' using errcode = '22023'; end if;
  select * into d from public.deals where id = p_deal_id and deleted_at is null for update;
  if not found then raise exception 'Deal not found' using errcode = 'P0002'; end if;
  insert into public.activities(deal_id,contact_id,created_by,type,direction,outcome,body)
    values(d.id,d.contact_id,public.current_profile_id(),'call','outbound',p_outcome,p_body);
  update public.deals set first_touch_at = coalesce(first_touch_at,now()),
    two_way_at = case when p_outcome = 'reached' then coalesce(two_way_at,now()) else two_way_at end,
    stage_key = case when p_outcome = 'reached' and stage_key = 'new' then 'contacted' else stage_key end,
    next_step = coalesce(nullif(trim(p_next_step),''),next_step), next_step_at = coalesce(p_next_step_at,next_step_at)
    where id = d.id returning * into d;
  update public.tasks set done_at = now() where deal_id = d.id and rule_key = 'new_lead' and done_at is null;
  if p_next_step_at is not null and nullif(trim(p_next_step),'') is not null then
    insert into public.tasks(deal_id,contact_id,title,due_at,created_by) values(d.id,d.contact_id,p_next_step,p_next_step_at,public.current_profile_id());
  end if;
  return d;
end $$;

create function public.record_consent(p_contact_id uuid,p_channel text,p_status text,p_source text,p_evidence text default null) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role(array['owner','staff']) and not public.is_service() then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_status = 'opt_in' and nullif(trim(p_evidence),'') is null then raise exception 'Evidence is required when recording consent' using errcode = '22023'; end if;
  insert into public.consents(contact_id,channel,status,source,evidence) values(p_contact_id,p_channel,p_status,p_source,p_evidence);
  if p_channel = 'sms' then
    update public.contacts set sms_opt_out_at = case when p_status = 'opt_out' then now() else null end where id = p_contact_id;
    if p_status = 'opt_out' then update public.message_drafts set status = 'cancelled' where contact_id = p_contact_id and channel = 'sms' and status = 'draft'; end if;
  elsif p_channel = 'email' then
    update public.contacts set email_opt_out_at = case when p_status = 'opt_out' then now() else null end where id = p_contact_id;
    if p_status = 'opt_out' then update public.message_drafts set status = 'cancelled' where contact_id = p_contact_id and channel = 'email' and status = 'draft'; end if;
  end if;
end $$;

create function public.guard_opt_out() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.sms_opt_out_at is not null and new.sms_opt_out_at is null and not exists(
    select 1 from public.consents where contact_id = old.id and channel = 'sms' and status = 'opt_in' and at >= old.sms_opt_out_at and nullif(evidence,'') is not null
  ) then raise exception 'Record new consent before removing an SMS opt-out' using errcode = '23514'; end if;
  if old.email_opt_out_at is not null and new.email_opt_out_at is null and not exists(
    select 1 from public.consents where contact_id = old.id and channel = 'email' and status = 'opt_in' and at >= old.email_opt_out_at and nullif(evidence,'') is not null
  ) then raise exception 'Record new consent before removing an email opt-out' using errcode = '23514'; end if;
  return new;
end $$;
create trigger guard_opt_out before update on public.contacts for each row execute function public.guard_opt_out();

-- Authenticated browsers cannot execute trigger routines or privileged integration helpers.
revoke all on function public.guard_deal_transition(),public.record_deal_transition(),public.create_lead(jsonb),public.move_deal_stage(uuid,text,text),public.log_call(uuid,text,text,text,timestamptz),public.record_consent(uuid,text,text,text,text),public.guard_opt_out() from public, anon, authenticated;
grant execute on function public.create_lead(jsonb),public.move_deal_stage(uuid,text,text),public.log_call(uuid,text,text,text,timestamptz),public.record_consent(uuid,text,text,text,text) to authenticated,service_role;
