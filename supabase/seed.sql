-- Optional development fixtures only. Never apply this to a production database.
-- All identities/businesses are fictional, emails use example.com, and mobiles
-- are from https://www.acma.gov.au/phone-numbers-use-tv-shows-films-and-creative-works
-- Run after migrations. Fails before writing if contacts/deals are already present.
begin;
do $seed$
#variable_conflict use_variable
declare
  person record; result jsonb; deal_id uuid; contact_id uuid; business_id uuid; product_once public.products; product_monthly public.products;
  stage_names text[]:=array['new','new','new','contacted','suitable','call_booked','brief','demo','quote','won','contacted','suitable','call_booked','brief','demo','quote','won','contacted','suitable','brief','demo','quote','won','contacted','suitable','brief','demo','contacted','quote','won'];
  stage_order text[]:=array['new','contacted','suitable','call_booked','brief','demo','quote','won'];
  channels text[]:=array['website','meta_form','chloe','referral','phone','business_card','manual','other'];
  stage text; channel text; v_created timestamptz; step integer; rank integer; quote_id uuid; project_id uuid; next_due timestamptz; outcome_name public.deal_outcome; inv public.invoices;
begin
  if exists(select 1 from public.contacts) or exists(select 1 from public.deals) then
    raise exception 'Seed refused: contacts or deals already exist. Use a separate empty development database.';
  end if;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  select * into product_once from public.products where kind='once' and active order by sort limit 1;
  select * into product_monthly from public.products where id=(select (config->>'hosting_product_id')::uuid from public.settings where singleton);
  for person in select * from (values
    (1,'James','Ellis','Ellis & Co Electrical','Electrician','Norwood','+61491570156'),
    (2,'Sarah','Mitchell','Form & Field Landscaping','Landscaper','Unley','+61491570157'),
    (3,'Daniel','Cooper','Cooper Plumbing Co.','Plumber','Glenelg','+61491570158'),
    (4,'Alex','Bennett','Bennett Built','Builder','Mitcham','+61491570006'),
    (5,'Olivia','Reed','Reed Painting Studio','Painter','Prospect','+61491570159'),
    (6,'Noah','Carter','Carter Climate','Air conditioning','Marion','+61491570110'),
    (7,'Amelia','Brooks','Brooks Roofing','Roofer','Burnside','+61491570313'),
    (8,'Henry','Parker','Parker Property Care','Handyman','Henley Beach','+61491570737'),
    (9,'Isla','Morgan','Morgan Joinery','Carpenter','Goodwood','+61491571266'),
    (10,'Jack','Bailey','Bailey Tiling','Tiler','St Peters','+61491571491'),
    (11,'Grace','Foster','Foster Earthworks','Earthmoving','Aldgate','+61491571804'),
    (12,'Leo','Hayes','Hayes Glassworks','Glazier','West Lakes','+61491572549'),
    (13,'Ruby','Clarke','Clarke Pool Care','Pool maintenance','Magill','+61491572665'),
    (14,'Oliver','Mason','Mason Security','Security installer','Walkerville','+61491572983'),
    (15,'Chloe','Ward','Ward Garden Co.','Gardener','Fullarton','+61491573770'),
    (16,'Thomas','Lane','Lane Concreting','Concreter','Blackwood','+61491573087'),
    (17,'Sophie','Turner','Turner Flooring','Flooring','Seaton','+61491574118'),
    (18,'William','Hart','Hart Solar','Solar installer','Mawson Lakes','+61491574632'),
    (19,'Ella','Reid','Reid Fencing','Fencing','Hawthorn','+61491575254'),
    (20,'Lucas','Gray','Gray Stonework','Stonemason','Crafers','+61491575789'),
    (21,'Mia','Wright','Wright Tree Care','Arborist','Belair','+61491576398'),
    (22,'Charlie','Wood','Wood & Wire','Electrician','Plympton','+61491576801'),
    (23,'Evie','Hill','Hill Cleaning Co.','Cleaner','Kensington','+61491577426'),
    (24,'Oscar','Green','Green Plumbing','Plumber','Parkside','+61491577644'),
    (25,'Zoe','Adams','Adams Renovations','Renovator','Grange','+61491578957'),
    (26,'Archie','Bell','Bell Brickwork','Bricklayer','Glynde','+61491578148'),
    (27,'Lily','Scott','Scott Render Co.','Renderer','Campbelltown','+61491578888'),
    (28,'George','Fox','Fox Garage Doors','Garage doors','Morphett Vale','+61491579212'),
    (29,'Lucy','King','King Pest Services','Pest control','Semaphore','+61491579760'),
    (30,'Hugo','West','West Waterproofing','Waterproofer','Croydon','+61491579455')
  ) fixture(n,first_name,last_name,business,trade,suburb,phone) loop
    stage:=stage_names[person.n]; channel:=channels[((person.n-1)%8)+1];
    v_created:=case when person.n<=3 then now()-make_interval(mins=>person.n*3) else now()-make_interval(days=>person.n) end;
    next_due:=case when person.n%7=0 then null else now()+make_interval(hours=>case when person.n%5=0 then -3 else person.n%4+1 end) end;
    result:=public.create_lead(jsonb_build_object('first_name',person.first_name,'last_name',person.last_name,'phone_e164',person.phone,
      'email',lower(person.first_name)||'.'||lower(person.last_name)||'@example.com','business',person.business,'trade',person.trade,'suburb',person.suburb,
      'website','https://example.com/'||lower(person.first_name),'title',person.business||' website','channel',channel,'received_at',v_created,
      'next_step','Call to agree the next step','next_step_at',next_due,'message','Fictional development enquiry. Wants a clear website showing recent work and service areas.',
      'attribution',jsonb_build_object('form_source',case when channel='website' then 'tradie-websites-landing' else channel end,
        'utm_campaign',case when channel='website' then '2610_tradies_founder' end,'utm_term',case when channel='website' then '2610_tradies_founder_set1' end,
        'utm_content',case when channel='website' then '2610_tradies_offer_h1_v1' end,
        'meta_lead_id',case when channel='meta_form' then 'fictional-lead-'||person.n end,
        'meta_ad_id',case when channel='meta_form' then 'fictional-ad-1' end,'meta_ad_name',case when channel='meta_form' then '2610_tradies_offer_h1_v1' end,
        'meta_adset_id',case when channel='meta_form' then 'fictional-adset-1' end,'meta_adset_name',case when channel='meta_form' then '2610_tradies_founder_set1' end,
        'meta_campaign_id',case when channel='meta_form' then 'fictional-campaign-1' end,'meta_campaign_name',case when channel='meta_form' then '2610_tradies_founder' end,
        'raw',jsonb_build_object('fictional',true,'details',jsonb_build_object('Your trade',person.trade)))));
    deal_id:=(result->>'deal_id')::uuid; contact_id:=(result->>'contact_id')::uuid; business_id:=(result->>'business_id')::uuid;
    update public.businesses set service_areas=array[person.suburb,'Adelaide metro'],notes='Fictional development business.' where id=business_id;
    update public.deals set value_once=case when person.n>3 then product_once.price end,value_monthly=case when person.n>3 then product_monthly.price end,
      next_step=case when next_due is null then null else 'Call to agree the next step' end,next_step_at=next_due,
      presales_minutes=case when person.n>3 then 15+person.n*3 else 0 end,
      demo_build_minutes=case when stage in ('demo','quote','won') then 60+person.n*2 else 0 end,
      first_touch_at=case when person.n>3 then v_created+make_interval(mins=>case when person.n%4=0 then 9 else 3 end) end,
      two_way_at=case when person.n>3 then v_created+interval '30 minutes' end
      where id=deal_id;
    if stage in ('quote','won') then
      insert into public.quotes(deal_id,number,status,issued_at,expires_at,total_once,total_monthly,notes)
        values(deal_id,'DEMO-Q-'||lpad(person.n::text,4,'0'),'draft',v_created+interval '1 day',now()+interval '21 days',product_once.price,product_monthly.price,
          'Fictional fixture. Configure your own written terms before sending any real quote.') returning id into quote_id;
      insert into public.quote_items(quote_id,product_id,description,qty,unit_price,kind,sort) values
        (quote_id,product_once.id,product_once.name,1,product_once.price,'once',0),
        (quote_id,product_monthly.id,product_monthly.name,1,product_monthly.price,'monthly',1);
      insert into public.quote_items(quote_id,description,qty,unit_price,kind,included,sort)
        values(quote_id,'First 3 months of local SEO',1,0,'once',true,2);
      update public.quotes set status='sent',
        terms_snapshot=jsonb_build_object('items',(select jsonb_agg(jsonb_build_object('description',description,'qty',qty,'unit_price',unit_price,'kind',kind,'included',included,'included_details','[]'::jsonb) order by sort) from public.quote_items where public.quote_items.quote_id=quote_id),
          'lumen',jsonb_build_object('trading_name','Lumen adl','email','','phone',''),'deposit_percentage',null),
        view_count=case when person.n%2=0 then 1 else 0 end,
        first_viewed_at=case when person.n%2=0 then now()-interval '2 days' end,last_viewed_at=case when person.n%2=0 then now()-interval '2 days' end
        where id=quote_id;
    end if;
    perform set_config('lumen.stage_override_reason','Fictional seed: representative won outcome; no real agreement or payment.',true);
    update public.deals set stage_key=stage where id=deal_id;
    perform set_config('lumen.stage_override_reason','',true);
    rank:=array_position(stage_order,stage);
    for step in 1..rank loop
      insert into public.deal_milestones(deal_id,milestone_key,first_reached_at)
        values(deal_id,stage_order[step],v_created+make_interval(hours=>step)) on conflict on constraint deal_milestones_deal_id_milestone_key_key do update set first_reached_at=excluded.first_reached_at;
    end loop;
    update public.deals set stage_entered_at=v_created+make_interval(hours=>rank) where id=deal_id;
    if person.n>3 then
      insert into public.activities(deal_id,contact_id,type,direction,outcome,body,occurred_at) values
        (deal_id,contact_id,'call','outbound','reached','Fictional call: discussed service areas, recent work, scope and decision makers.',v_created+interval '30 minutes');
      insert into public.activities(deal_id,contact_id,type,body,occurred_at) values
        (deal_id,contact_id,'note','Fictional note: confirm photos, logo and priorities before the homepage demo.',v_created+interval '2 hours');
      update public.tasks set done_at=v_created+interval '30 minutes' where public.tasks.deal_id=deal_id and rule_key='new_lead';
    end if;
    if stage='call_booked' then
      insert into public.appointments(deal_id,contact_id,starts_at,ends_at,source,notes)
        values(deal_id,contact_id,now()+make_interval(hours=>person.n%3+1),now()+make_interval(hours=>person.n%3+1,mins=>15),'chloe',
          'Fictional call prep: trade confirmed, Adelaide service areas, replacing an old website, owner makes the decision.');
      update public.deals set chloe_status='booked',chloe_fields=jsonb_build_object('trade',person.trade,'areas',person.suburb,'goals','Show recent work and make enquiries easier','decision_makers','Business owner') where id=deal_id;
    end if;
    if stage in ('brief','demo','quote') then
      insert into public.demos(deal_id,status,url,sent_at,build_minutes) values(deal_id,case when stage='brief' then 'to_build' else 'sent' end,
        case when stage<>'brief' then 'https://example.com/demo-'||person.n end,case when stage<>'brief' then now()-interval '1 day' end,case when stage='brief' then 0 else 90 end);
      update public.deals set promised_text='Fictional promise: send demo and quote tomorrow',promised_due_at=now()+interval '1 day' where id=deal_id;
    end if;
    outcome_name:=case when person.n in (24,27) then 'lost'::public.deal_outcome when person.n=25 then 'unsuitable'::public.deal_outcome when person.n in (26,28) then 'noreply'::public.deal_outcome else null end;
    if outcome_name is not null then
      update public.deals set outcome=outcome_name,lost_reason=case outcome_name when 'lost' then 'Timing' when 'unsuitable' then 'Not a fit' else null end,next_step=null,next_step_at=null where id=deal_id;
    end if;
    if person.n=28 then perform public.record_consent(contact_id,'sms','opt_out','fictional_seed','Fictional STOP example'); end if;
    if stage='won' then
      insert into public.projects(deal_id,business_id,name,stage_key,template_key,feature_permission)
        values(deal_id,business_id,person.business||' website',case when person.n%2=0 then 'build' else 'hosting' end,'website','unknown') returning id into project_id;
      insert into public.checklist_items(project_id,section,title,sort)
        select project_id,value->>'section',value->>'title',(ordinality-1)::integer
        from public.settings,jsonb_array_elements(config#>'{project_templates,website}') with ordinality where singleton;
      insert into public.subscriptions(business_id,product_id,price,started_on,billing_day,next_invoice_on)
        values(business_id,product_monthly.id,product_monthly.price,current_date-30,least(extract(day from current_date)::integer,28),current_date+7);
      inv:=public.create_invoice(jsonb_build_object('business_id',business_id,'contact_id',contact_id,'deal_id',deal_id,'project_id',project_id,
        'issued_on',current_date-21,'due_on',current_date-7,'notes','Fictional invoice. No real payment is due.',
        'items',jsonb_build_array(jsonb_build_object('description','Fictional website build','qty',1,'unit_price',product_once.price))));
      update public.invoices set status='sent',sent_at=now()-interval '21 days' where id=inv.id;
    end if;
  end loop;
  insert into public.ad_spend_daily(date,ad_id,account_id,campaign_id,campaign_name,adset_id,adset_name,ad_name,spend,impressions,clicks,link_clicks,meta_leads)
    select current_date-offset_days,'fictional-ad-1','fictional-account','fictional-campaign-1','2610_tradies_founder','fictional-adset-1','2610_tradies_founder_set1','2610_tradies_offer_h1_v1',30,1200,24,20,1
    from generate_series(0,6) offset_days;
  -- Fixtures never dispatch notifications or background work.
  update public.job_runs set status='done',finished_at=now();
  update public.notifications_log set status='sent',sent_at=now();
end $seed$;
commit;
