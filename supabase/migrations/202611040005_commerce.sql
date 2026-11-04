-- Owner-only commerce writers. Public quote functions expose a narrow token
-- capability, enforce their own rate limit, and never grant anonymous table reads.
alter table public.invoices add column quote_id uuid references public.quotes(id);
create index invoices_quote_idx on public.invoices(quote_id);
update public.settings set config=config||jsonb_build_object(
  'hosting_product_id',(select id from public.products where name='Hosting and maintenance' and deleted_at is null limit 1),
  'product_project_templates',(select coalesce(jsonb_object_agg(id::text,case when name='Premium website' then 'premium' else 'website' end),'{}'::jsonb) from public.products where kind='once' and deleted_at is null)
) where singleton;

create function public.guard_quote_acceptance() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='accepted' and (tg_op='INSERT' or old.status<>'accepted') and
    coalesce(current_setting('lumen.accepting_quote',true),'')<>new.id::text then
    raise exception 'Use the quote acceptance link to record agreement' using errcode='23514';
  end if;
  if tg_op='UPDATE' and old.status<>'draft' and not public.is_service() and coalesce(current_setting('lumen.anonymising_contact',true),'')='' then
    if new.deal_id<>old.deal_id and coalesce(current_setting('lumen.merging_into',true),'')<>new.deal_id::text then
      raise exception 'Issued quotes can only move through a deal merge' using errcode='23514';
    end if;
    if (new.number,new.public_token,new.total_once,new.total_monthly,new.terms_url,new.terms_snapshot,new.issued_at,new.expires_at,new.notes)
      is distinct from (old.number,old.public_token,old.total_once,old.total_monthly,old.terms_url,old.terms_snapshot,old.issued_at,old.expires_at,old.notes) then
      raise exception 'Create a revised quote to change issued prices or terms' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
create trigger guard_quote_acceptance before insert or update on public.quotes for each row execute function public.guard_quote_acceptance();
create function public.guard_quote_items() returns trigger language plpgsql security definer set search_path='' as $$
declare parent_status text; parent_id uuid;
begin
  if coalesce(current_setting('lumen.anonymising_contact',true),'')<>'' then return case when tg_op='DELETE' then old else new end; end if;
  parent_id:=case when tg_op='DELETE' then old.quote_id else new.quote_id end;
  select status into parent_status from public.quotes where id=parent_id for update;
  if parent_status<>'draft' then raise exception 'Create a revised quote to change an issued quote' using errcode='23514'; end if;
  if tg_op='UPDATE' and new.quote_id<>old.quote_id then raise exception 'Quote lines cannot be moved' using errcode='23514'; end if;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger guard_quote_items before insert or update or delete on public.quote_items for each row execute function public.guard_quote_items();

create function public.recalculate_quote_totals() returns trigger language plpgsql security definer set search_path='' as $$
declare quote_uuid uuid;
begin
  quote_uuid:=case when tg_op='DELETE' then old.quote_id else new.quote_id end;
  update public.quotes q set total_once=coalesce((select sum(round(qty*unit_price,2)) from public.quote_items where quote_id=quote_uuid and kind='once' and not included and deleted_at is null),0),
    total_monthly=coalesce((select sum(round(qty*unit_price,2)) from public.quote_items where quote_id=quote_uuid and kind='monthly' and not included and deleted_at is null),0)
    where q.id=quote_uuid;
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger recalculate_quote_totals after insert or update or delete on public.quote_items for each row execute function public.recalculate_quote_totals();

create function public.create_quote(p_deal_id uuid,p_items jsonb,p_expires_at timestamptz default null,p_notes text default null) returns public.quotes language plpgsql security definer set search_path='' as $$
declare cfg jsonb; seq integer; q public.quotes; line jsonb;
begin
  if not public.has_role(array['owner']) then raise exception 'Owner access required' using errcode='42501'; end if;
  if not exists(select 1 from public.deals where id=p_deal_id and deleted_at is null) then raise exception 'Deal not found' using errcode='P0002'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Add between 1 and 100 quote items' using errcode='22023'; end if;
  select config into cfg from public.settings where singleton for update;
  seq:=coalesce((cfg#>>'{quotes,next_number}')::integer,1);
  update public.settings set config=jsonb_set(config,'{quotes,next_number}',to_jsonb(seq+1)) where singleton;
  insert into public.quotes(deal_id,number,expires_at,terms_url,notes)
    values(p_deal_id,coalesce(cfg#>>'{quotes,prefix}','QUO-')||lpad(seq::text,greatest(4,length(seq::text)),'0'),coalesce(p_expires_at,now()+make_interval(days=>coalesce((cfg#>>'{quotes,validity_days}')::integer,30))),
      nullif(cfg#>>'{quotes,terms_url}',''),p_notes) returning * into q;
  for line in select value from jsonb_array_elements(p_items) loop
    insert into public.quote_items(quote_id,product_id,description,qty,unit_price,kind,included,sort)
      values(q.id,nullif(line->>'product_id','')::uuid,coalesce(nullif(trim(line->>'description'),''),'Service'),coalesce((line->>'qty')::numeric,1),
        coalesce((line->>'unit_price')::numeric,0),coalesce(line->>'kind','once'),coalesce((line->>'included')::boolean,false),coalesce((line->>'sort')::integer,0));
  end loop;
  select * into q from public.quotes where id=q.id;
  return q;
end $$;

create function public.issue_quote(p_quote_id uuid) returns public.quotes language plpgsql security definer set search_path='' as $$
declare q public.quotes; cfg jsonb; item_snapshot jsonb;
begin
  if not public.has_role(array['owner']) then raise exception 'Owner access required' using errcode='42501'; end if;
  select * into q from public.quotes where id=p_quote_id and deleted_at is null for update;
  if q.id is null then raise exception 'Quote not found' using errcode='P0002'; end if;
  if q.status in ('sent','viewed') then return q; end if;
  if q.status<>'draft' then raise exception 'This quote cannot be issued' using errcode='23514'; end if;
  select config into cfg from public.settings where singleton;
  if nullif(trim(cfg#>>'{quotes,terms_url}'),'') is null or cfg#>>'{quotes,terms_url}' !~ '^https://' then
    raise exception 'Set your written terms HTTPS URL in Settings before sending a quote' using errcode='23514';
  end if;
  if q.expires_at<=now() then raise exception 'Set a future expiry date' using errcode='23514'; end if;
  if not exists(select 1 from public.quote_items where quote_id=q.id and deleted_at is null) then raise exception 'Add a quote item first' using errcode='23514'; end if;
  select jsonb_agg(jsonb_build_object('description',qi.description,'qty',qi.qty,'unit_price',qi.unit_price,'kind',qi.kind,'included',qi.included,'included_details',coalesce(to_jsonb(p.included),'[]'::jsonb),'sort',qi.sort) order by qi.sort,qi.created_at)
    into item_snapshot from public.quote_items qi left join public.products p on p.id=qi.product_id where qi.quote_id=q.id and qi.deleted_at is null;
  update public.quotes set status='sent',issued_at=now(),terms_url=cfg#>>'{quotes,terms_url}',
    terms_snapshot=jsonb_build_object('deposit_percentage',cfg#>'{quotes,deposit_percentage}','lumen',jsonb_build_object('trading_name',cfg#>>'{business,trading_name}','email',cfg#>>'{business,email}','phone',cfg#>>'{business,phone}'),'items',item_snapshot,'gst',cfg->'gst')
    where id=q.id returning * into q;
  insert into public.activities(deal_id,contact_id,created_by,type,body,meta)
    select q.deal_id,contact_id,public.current_profile_id(),'quote_sent','Quote issued',jsonb_build_object('quote_id',q.id,'number',q.number) from public.deals where id=q.deal_id;
  update public.deals set stage_key='quote',value_once=q.total_once,value_monthly=q.total_monthly where id=q.deal_id and outcome='open';
  return q;
end $$;

create function public.quote_capability(p_token text,p_action text) returns public.quotes language plpgsql security definer set search_path='' as $$
declare q public.quotes; win timestamptz; used integer; rate_key text; cap integer;
begin
  if p_token is null or length(p_token)<>43 or p_token !~ '^[A-Za-z0-9_-]+$' then raise exception 'Quote not found' using errcode='P0002'; end if;
  select * into q from public.quotes where public_token=p_token and deleted_at is null and status<>'draft';
  if q.id is null then raise exception 'Quote not found' using errcode='P0002'; end if;
  rate_key:='quote:'||q.id||':'||p_action; cap:=case when p_action='accept' then 5 else 60 end;
  win:=date_trunc('minute',now());
  insert into public.rate_limits(key,window_start,count) values(rate_key,win,1) on conflict(key)
    do update set count=case when public.rate_limits.window_start=win then public.rate_limits.count+1 else 1 end,window_start=win returning count into used;
  if used>cap then raise exception 'Too many requests; try again shortly' using errcode='P0001'; end if;
  return q;
end $$;

create function public.public_quote(p_token text) returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.quotes; business_name text;
begin
  q:=public.quote_capability(p_token,'read');
  select coalesce(b.name,nullif(concat_ws(' ',c.first_name,c.last_name),''),'Your business') into business_name
    from public.deals d join public.contacts c on c.id=d.contact_id left join public.businesses b on b.id=d.business_id where d.id=q.deal_id;
  return jsonb_build_object('number',q.number,'status',q.status,'issued_at',q.issued_at,'expires_at',q.expires_at,'accepted_at',q.accepted_at,
    'business_name',business_name,'total_once',q.total_once,'total_monthly',q.total_monthly,'terms_url',q.terms_url,'notes',q.notes,
    'items',q.terms_snapshot->'items','lumen',q.terms_snapshot->'lumen','deposit_percentage',q.terms_snapshot->'deposit_percentage','gst',q.terms_snapshot->'gst');
end $$;

create function public.record_quote_view(p_token text) returns void language plpgsql security definer set search_path='' as $$
declare q public.quotes;
begin
  q:=public.quote_capability(p_token,'view');
  select * into q from public.quotes where id=q.id for update;
  update public.quotes set view_count=view_count+1,first_viewed_at=coalesce(first_viewed_at,now()),last_viewed_at=now(),
    status=case when status='sent' then 'viewed' else status end where id=q.id;
  if q.first_viewed_at is null then
    insert into public.activities(deal_id,contact_id,type,body,meta)
      select q.deal_id,contact_id,'quote_viewed','Quote viewed',jsonb_build_object('quote_id',q.id) from public.deals where id=q.deal_id;
  end if;
end $$;

create function public.create_invoice(p_input jsonb) returns public.invoices language plpgsql security definer set search_path='' as $$
declare cfg jsonb; seq integer; inv public.invoices; line jsonb; lines jsonb:=p_input->'items';
  gross numeric(12,2); tax numeric(12,2); net numeric(12,2); issued date; due date; registered boolean; tax_rate numeric; invoice_number text;
begin
  if not public.has_role(array['owner']) and not public.is_service() and coalesce(current_setting('lumen.accepting_quote',true),'')='' then raise exception 'Owner access required' using errcode='42501'; end if;
  if jsonb_typeof(lines)<>'array' or jsonb_array_length(lines) not between 1 and 100 then raise exception 'Add between 1 and 100 invoice items' using errcode='22023'; end if;
  select config into cfg from public.settings where singleton for update;
  seq:=coalesce((cfg#>>'{invoices,next_number}')::integer,1);
  invoice_number:=coalesce(cfg#>>'{invoices,prefix}','LUM-')||lpad(seq::text,greatest(4,length(seq::text)),'0');
  issued:=coalesce(nullif(p_input->>'issued_on','')::date,(now() at time zone 'Australia/Adelaide')::date);
  due:=coalesce(nullif(p_input->>'due_on','')::date,issued+coalesce((cfg#>>'{invoices,payment_terms_days}')::integer,14));
  select coalesce(sum(case when coalesce((value->>'included')::boolean,false) then 0 else round(coalesce((value->>'qty')::numeric,1)*coalesce((value->>'unit_price')::numeric,0),2) end),0) into gross from jsonb_array_elements(lines);
  registered:=coalesce((cfg#>>'{gst,registered}')::boolean,false); tax_rate:=coalesce((cfg#>>'{gst,rate}')::numeric,0.1);
  if tax_rate<0 or tax_rate>1 then raise exception 'Invalid GST rate' using errcode='23514'; end if;
  net:=case when registered then round(gross/(1+tax_rate),2) else gross end; tax:=gross-net;
  insert into public.invoices(number,business_id,contact_id,deal_id,project_id,subscription_id,quote_id,issued_on,due_on,subtotal,gst,total,notes,gst_wording,billing_snapshot)
    values(invoice_number,nullif(p_input->>'business_id','')::uuid,nullif(p_input->>'contact_id','')::uuid,nullif(p_input->>'deal_id','')::uuid,
      nullif(p_input->>'project_id','')::uuid,nullif(p_input->>'subscription_id','')::uuid,nullif(p_input->>'quote_id','')::uuid,issued,due,net,tax,gross,p_input->>'notes',
      case when registered then 'GST included.' else coalesce(cfg#>>'{gst,wording}','No GST was charged.') end,
      jsonb_build_object('business',cfg->'business','gst_registered',registered)) returning * into inv;
  for line in select value from jsonb_array_elements(lines) loop
    insert into public.invoice_items(invoice_id,product_id,description,qty,unit_price,included,sort)
      values(inv.id,nullif(line->>'product_id','')::uuid,coalesce(nullif(trim(line->>'description'),''),'Service'),coalesce((line->>'qty')::numeric,1),
        coalesce((line->>'unit_price')::numeric,0),coalesce((line->>'included')::boolean,false),coalesce((line->>'sort')::integer,0));
  end loop;
  update public.settings set config=jsonb_set(config,'{invoices,next_number}',to_jsonb(seq+1)) where singleton;
  return inv;
end $$;

create function public.accept_quote(p_token text,p_name text,p_terms_accepted boolean,p_ip inet default null,p_user_agent text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare q public.quotes; d public.deals; project public.projects; inv public.invoices; cfg jsonb; item jsonb; position integer:=0; deposit numeric; template_name text;
begin
  if not coalesce(p_terms_accepted,false) or length(trim(coalesce(p_name,''))) not between 2 and 200 then raise exception 'Enter your full name and accept the written terms' using errcode='22023'; end if;
  q:=public.quote_capability(p_token,'accept');
  select * into q from public.quotes where id=q.id for update;
  if q.status='accepted' then
    select * into project from public.projects where deal_id=q.deal_id and deleted_at is null limit 1;
    return jsonb_build_object('quote_id',q.id,'deal_id',q.deal_id,'project_id',project.id,'already_accepted',true,'accepted_at',q.accepted_at);
  end if;
  if q.status not in ('sent','viewed') or q.expires_at<=now() then raise exception 'This quote is no longer available to accept. Please contact Lumen.' using errcode='23514'; end if;
  if nullif(q.terms_url,'') is null then raise exception 'Written terms are required before acceptance' using errcode='23514'; end if;
  select * into d from public.deals where id=q.deal_id and deleted_at is null for update;
  if d.id is null then raise exception 'Quote not found' using errcode='P0002'; end if;
  select config into cfg from public.settings where singleton;
  perform set_config('lumen.accepting_quote',q.id::text,true);
  update public.quotes set status='accepted',accepted_at=now(),accepted_name=trim(p_name),accepted_ip=p_ip,accepted_user_agent=left(p_user_agent,1000) where id=q.id returning * into q;
  insert into public.activities(deal_id,contact_id,type,body,meta)
    values(d.id,d.contact_id,'quote_accepted','Quote accepted',jsonb_build_object('quote_id',q.id,'number',q.number));
  if exists(select 1 from public.automations where key='quote_accepted' and enabled) then
    update public.deals set stage_key='won',outcome='won',value_once=q.total_once,value_monthly=q.total_monthly,next_step='Arrange kickoff',next_step_at=now() where id=d.id;
    select cfg#>>array['product_project_templates',product_id::text] into template_name from public.quote_items
      where quote_id=q.id and kind='once' and product_id is not null and deleted_at is null order by sort limit 1;
    insert into public.projects(deal_id,business_id,name,template_key)
      values(d.id,d.business_id,d.title,coalesce(template_name,'website')) on conflict(deal_id) where deal_id is not null and deleted_at is null do nothing;
    select * into project from public.projects where deal_id=d.id and deleted_at is null;
    if not exists(select 1 from public.checklist_items where project_id=project.id) then
      for item in select value from jsonb_array_elements(coalesce(cfg#>array['project_templates',project.template_key],'[]'::jsonb)) loop
        insert into public.checklist_items(project_id,section,title,sort) values(project.id,item->>'section',item->>'title',position);
        position:=position+1;
      end loop;
    end if;
    deposit:=nullif(q.terms_snapshot->>'deposit_percentage','')::numeric;
    if deposit is not null and deposit>0 then
      if deposit>100 then raise exception 'Deposit percentage must not exceed 100' using errcode='23514'; end if;
      inv:=public.create_invoice(jsonb_build_object('business_id',d.business_id,'contact_id',d.contact_id,'deal_id',d.id,'project_id',project.id,'quote_id',q.id,
        'notes','Deposit for quote '||q.number,'items',jsonb_build_array(jsonb_build_object('description','Website deposit · '||deposit||'% of '||q.number,'qty',1,'unit_price',round(q.total_once*deposit/100,2)))));
    end if;
    insert into public.tasks(deal_id,contact_id,project_id,title,due_at,rule_key)
      values(d.id,d.contact_id,project.id,'Arrange kickoff',now(),'quote_accepted') on conflict(deal_id,rule_key) where rule_key is not null and deleted_at is null do nothing;
  end if;
  insert into public.notifications_log(event_key,entity_id,channel,status)
    values('quote_accepted:'||q.id,d.id,'telegram','pending') on conflict(event_key,channel) do nothing;
  insert into public.job_runs(key,kind,entity_id) values('quote_accepted:'||q.id,'quote_accepted',q.id) on conflict(key) do nothing;
  perform set_config('lumen.accepting_quote','',true);
  return jsonb_build_object('quote_id',q.id,'deal_id',d.id,'project_id',project.id,'invoice_id',inv.id,'already_accepted',false,'accepted_at',q.accepted_at);
end $$;

create function public.record_payment(p_invoice_id uuid,p_amount numeric,p_received_on date default current_date,p_method text default 'bank_transfer',p_reference text default null) returns public.payments language plpgsql security definer set search_path='' as $$
declare inv public.invoices; payment public.payments; paid numeric;
begin
  if not public.has_role(array['owner']) then raise exception 'Owner access required' using errcode='42501'; end if;
  select * into inv from public.invoices where id=p_invoice_id and deleted_at is null for update;
  if inv.id is null then raise exception 'Invoice not found' using errcode='P0002'; end if;
  if inv.status='void' then raise exception 'A void invoice cannot receive a payment' using errcode='23514'; end if;
  if p_amount<=0 or round(p_amount,2)<>p_amount then raise exception 'Enter a positive payment with at most two decimal places' using errcode='22023'; end if;
  select coalesce(sum(amount),0) into paid from public.payments where invoice_id=inv.id and deleted_at is null;
  if paid+p_amount>inv.total then raise exception 'Payment exceeds the outstanding balance' using errcode='23514'; end if;
  insert into public.payments(invoice_id,amount,received_on,method,reference) values(inv.id,p_amount,p_received_on,p_method,p_reference) returning * into payment;
  paid:=paid+p_amount;
  update public.invoices set status=case when paid>=total then 'paid' else 'part_paid' end,paid_at=case when paid>=total then now() else null end where id=inv.id;
  insert into public.activities(deal_id,contact_id,created_by,type,body,meta)
    values(inv.deal_id,inv.contact_id,public.current_profile_id(),'payment','Payment recorded',jsonb_build_object('invoice_id',inv.id,'payment_id',payment.id,'amount',p_amount));
  return payment;
end $$;

create function public.launch_project(p_project_id uuid,p_site_url text) returns public.projects language plpgsql security definer set search_path='' as $$
declare p public.projects; d public.deals; hosting public.products; launch_day date; month_num integer; hosting_id uuid;
begin
  if not public.has_role(array['owner','staff']) then raise exception 'Forbidden' using errcode='42501'; end if;
  if p_site_url !~ '^https://' then raise exception 'Enter the live HTTPS website URL' using errcode='22023'; end if;
  select * into p from public.projects where id=p_project_id and deleted_at is null for update;
  if p.id is null then raise exception 'Project not found' using errcode='P0002'; end if;
  if p.launched_at is not null then return p; end if;
  update public.projects set stage_key='launched',launched_at=now(),site_url=p_site_url where id=p.id returning * into p;
  select * into d from public.deals where id=p.deal_id;
  if exists(select 1 from public.automations where key='project_launched' and enabled) then
    launch_day:=(now() at time zone 'Australia/Adelaide')::date;
    select nullif(config->>'hosting_product_id','')::uuid into hosting_id from public.settings where singleton;
    select * into hosting from public.products where id=hosting_id and kind='monthly' and active and deleted_at is null;
    if hosting.id is not null and p.business_id is not null then
      insert into public.subscriptions(business_id,product_id,price,started_on,billing_day,next_invoice_on)
        values(p.business_id,hosting.id,coalesce(d.value_monthly,hosting.price),launch_day,least(extract(day from launch_day)::integer,28),(launch_day+interval '1 month')::date);
    end if;
    for month_num in 1..3 loop
      insert into public.tasks(deal_id,contact_id,project_id,title,due_at,rule_key)
        values(d.id,d.contact_id,p.id,'Local SEO month '||month_num,((launch_day+make_interval(months=>month_num))::date+time '09:00') at time zone 'Australia/Adelaide','local_seo_'||month_num)
        on conflict(deal_id,rule_key) where rule_key is not null and deleted_at is null do nothing;
    end loop;
    insert into public.tasks(deal_id,contact_id,project_id,title,due_at,rule_key) values
      (d.id,d.contact_id,p.id,'Request a review',((launch_day+14)+time '09:00') at time zone 'Australia/Adelaide','review_request'),
      (d.id,d.contact_id,p.id,'Ask permission to feature',((launch_day+14)+time '09:00') at time zone 'Australia/Adelaide','feature_permission')
      on conflict(deal_id,rule_key) where rule_key is not null and deleted_at is null do nothing;
  end if;
  return p;
end $$;

-- Hide invoice/payment timeline entries from staff as well as finance tables.
drop policy app_read on public.activities;
drop policy app_insert on public.activities;
drop policy app_update on public.activities;
create policy app_read on public.activities for select to authenticated using (public.has_role(array['owner']) or (deleted_at is null and (public.has_role(array['viewer']) or (public.has_role(array['staff']) and type not in ('invoice_sent','payment') and not (meta ? 'invoice_id')))));
create policy app_insert on public.activities for insert to authenticated with check (public.has_role(array['owner']) or (deleted_at is null and public.has_role(array['staff']) and type not in ('invoice_sent','payment') and not (meta ? 'invoice_id')));
create policy app_update on public.activities for update to authenticated using (public.has_role(array['owner']) or (deleted_at is null and public.has_role(array['staff']) and type not in ('invoice_sent','payment') and not (meta ? 'invoice_id'))) with check (public.has_role(array['owner']) or (deleted_at is null and public.has_role(array['staff']) and type not in ('invoice_sent','payment') and not (meta ? 'invoice_id')));

revoke all on function public.guard_quote_items(),public.recalculate_quote_totals(),public.create_quote(uuid,jsonb,timestamptz,text),public.issue_quote(uuid),public.quote_capability(text,text),public.public_quote(text),public.record_quote_view(text),public.create_invoice(jsonb),public.accept_quote(text,text,boolean,inet,text),public.record_payment(uuid,numeric,date,text,text),public.launch_project(uuid,text) from public,anon,authenticated;
revoke all on function public.guard_quote_acceptance() from public,anon,authenticated;
grant execute on function public.create_quote(uuid,jsonb,timestamptz,text),public.issue_quote(uuid),public.create_invoice(jsonb),public.record_payment(uuid,numeric,date,text,text),public.launch_project(uuid,text) to authenticated;
grant execute on function public.create_invoice(jsonb) to service_role;
grant execute on function public.public_quote(text),public.record_quote_view(text),public.accept_quote(text,text,boolean,inet,text) to anon,authenticated;

create function public.invoice_from_quote(p_quote_id uuid,p_kind text) returns public.invoices language plpgsql security definer set search_path='' as $$
declare q public.quotes; d public.deals; inv public.invoices; prior numeric; amount numeric; deposit numeric; project_uuid uuid;
begin
  if not public.has_role(array['owner']) then raise exception 'Owner access required' using errcode='42501'; end if;
  if p_kind not in ('deposit','balance') then raise exception 'Choose deposit or balance' using errcode='22023'; end if;
  select * into q from public.quotes where id=p_quote_id and deleted_at is null for update;
  if q.id is null then raise exception 'Quote not found' using errcode='P0002'; end if;
  if q.status<>'accepted' then raise exception 'Accept the quote before creating its invoice' using errcode='23514'; end if;
  select * into d from public.deals where id=q.deal_id;
  select id into project_uuid from public.projects where deal_id=d.id and deleted_at is null limit 1;
  select coalesce(sum(total),0) into prior from public.invoices where quote_id=q.id and status<>'void';
  if p_kind='deposit' then
    deposit:=nullif(q.terms_snapshot->>'deposit_percentage','')::numeric;
    if deposit is null or deposit<=0 then raise exception 'This quote has no deposit percentage' using errcode='23514'; end if;
    amount:=least(round(q.total_once*deposit/100,2)-prior,q.total_once-prior);
  else amount:=q.total_once-prior;
  end if;
  if amount<=0 then raise exception 'This amount has already been invoiced' using errcode='23514'; end if;
  inv:=public.create_invoice(jsonb_build_object('business_id',d.business_id,'contact_id',d.contact_id,'deal_id',d.id,'project_id',project_uuid,'quote_id',q.id,
    'notes','Quote '||q.number||'. Monthly services: $'||q.total_monthly||'/month.',
    'items',jsonb_build_array(jsonb_build_object('description',case when p_kind='deposit' then 'Website deposit' else 'Website balance' end||' · '||q.number,'qty',1,'unit_price',amount))));
  return inv;
end $$;

create function public.prepare_invoice_message(p_invoice_id uuid,p_request_id uuid,p_body text,p_subject text) returns jsonb language plpgsql security definer set search_path='' as $$
declare inv public.invoices; c public.contacts; a public.activities; latest_consent text;
begin
  if not public.has_role(array['owner']) then raise exception 'Owner access required' using errcode='42501'; end if;
  if nullif(trim(p_body),'') is null or length(p_body)>10000 then raise exception 'Enter an invoice message' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtext('send:'||p_request_id));
  select * into a from public.activities where meta->>'request_id'=p_request_id::text;
  if a.id is not null then
    if a.meta->>'invoice_id' is distinct from p_invoice_id::text then raise exception 'Request identifier already used' using errcode='23514'; end if;
    return jsonb_build_object('activity_id',a.id,'duplicate',true);
  end if;
  select * into inv from public.invoices where id=p_invoice_id and deleted_at is null;
  if inv.id is null then raise exception 'Invoice not found' using errcode='P0002'; end if;
  if inv.status='void' then raise exception 'A void invoice cannot be sent' using errcode='23514'; end if;
  select * into c from public.contacts where id=inv.contact_id and deleted_at is null for update;
  if c.id is null or c.email is null then raise exception 'Link a contact with an email before sending' using errcode='23514'; end if;
  if c.do_not_contact or c.email_opt_out_at is not null then raise exception 'This contact has opted out of email' using errcode='23514'; end if;
  select status into latest_consent from public.consents where contact_id=c.id and channel='email' order by at desc,created_at desc limit 1;
  if latest_consent is distinct from 'opt_in' then raise exception 'Record email consent before sending' using errcode='23514'; end if;
  insert into public.activities(deal_id,contact_id,created_by,type,direction,body,meta)
    values(inv.deal_id,c.id,public.current_profile_id(),'email_out','outbound',p_body,
      jsonb_build_object('request_id',p_request_id,'invoice_id',inv.id,'delivery_status','pending','subject',p_subject)) returning * into a;
  return jsonb_build_object('activity_id',a.id,'email',c.email,'duplicate',false);
end $$;
revoke all on function public.invoice_from_quote(uuid,text),public.prepare_invoice_message(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.invoice_from_quote(uuid,text),public.prepare_invoice_message(uuid,uuid,text,text) to authenticated;
