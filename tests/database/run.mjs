import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { generateTypes } from '../../supabase/scripts/types.mjs';
process.on('uncaughtException',error=>{
  console.error(error.message, {code:error.code,position:error.position,where:error.where,detail:error.detail});
  if(error.position && error.query) console.error(error.query.slice(Math.max(0,Number(error.position)-160),Number(error.position)+160));
  process.exit(1);
});

// Execute the real migrations in PostgreSQL WASM. Auth/storage are the only
// harness stubs; policies, functions, constraints and triggers are real SQL.
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec([
  'create role anon nologin;',
  'create role authenticated nologin;',
  'create role service_role nologin bypassrls;',
  'create schema auth;',
  'create schema storage;',
  'create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);',
  "create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;",
  "create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;",
  "create function auth.role() returns text language sql stable as $$ select coalesce(auth.jwt()->>'role','') $$;",
  'create table storage.buckets(id text primary key, name text, public boolean default false, file_size_limit bigint);',
  'create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text);',
  'alter table storage.objects enable row level security;',
  "create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name,'/') $$;",
  'grant usage on schema public,auth,storage to anon,authenticated,service_role;',
  'grant select,insert,update,delete on storage.objects to authenticated;',
  'grant all on all tables in schema storage to service_role;',
].join('\n'));

const phase=Number(process.argv.find(a=>a.startsWith('--phase='))?.split('=')[1]??(process.argv.includes('--phase1')?'1':'99'));
const migrationPhase=f=>f.includes('004_')||f.includes('006_')?2:f.includes('005_')?3:f.includes('009_')||f.includes('010_')?5:f<'202611040004'?1:4;
const migrationFiles=(await readdir('supabase/migrations')).filter(f => f.endsWith('.sql') && migrationPhase(f)<=phase).sort();
const includePhase2=migrationFiles.some(f=>f.includes('004_ingestion'));
for (const file of migrationFiles) {
  try { await db.exec(await readFile(path.join('supabase/migrations',file),'utf8')); }
  catch (error) { console.error('Migration failed: '+file); throw error; }
  console.log('Applied '+file);
}
if (process.argv.includes('--schema')) {
  const columns = await db.query("select table_name,column_name,udt_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='public' order by table_name,ordinal_position");
  await writeFile('supabase/schema-columns.json',JSON.stringify(columns.rows,null,2)+'\n');
}
if (process.argv.includes('--types')) await generateTypes(db);
if (process.argv.includes('--seed')) {
  const seed=await readFile('supabase/seed.sql','utf8');
  await db.exec(seed);
  const seeded=await db.query("select count(*)::int total,count(distinct stage_key)::int stages,count(distinct outcome)::int outcomes,count(distinct channel)::int channels from public.deals");
  assert.deepEqual(seeded.rows[0],{total:30,stages:8,outcomes:5,channels:8});
  assert.equal((await db.query("select count(*)::int total from public.contacts where email not like '%@example.com'")).rows[0].total,0);
  await assert.rejects(()=>db.exec(seed),/Seed refused/);
  await db.exec('rollback');
  assert.equal((await db.query('select count(*)::int total from public.deals')).rows[0].total,30);
  console.log('PASS seed: 30 fictional leads, all stages/outcomes/sources, non-empty database protected');
  await db.close();
  process.exit(0);
}
const owner = '00000000-0000-4000-8000-000000000001';
const staff = '00000000-0000-4000-8000-000000000002';
const viewer = '00000000-0000-4000-8000-000000000003';
const outsider = '00000000-0000-4000-8000-000000000004';
await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()),($3,$4,now()),($5,$6,now()),($7,$8,now())',[owner,'owner@example.com',staff,'staff@example.com',viewer,'viewer@example.com',outsider,'outsider@example.com']);
await db.query("insert into public.profiles(user_id,name,role) values($1,'Owner','owner'),($2,'Staff','staff'),($3,'Viewer','viewer')",[owner,staff,viewer]);
const actAs=async(user,aal='aal2')=>{
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,aal,role:'authenticated'})]);
  await db.exec('set role authenticated');
};
const service=async()=>{
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'service_role'})]);
  await db.exec('set role service_role');
};
const anonymous=async()=>{
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({role:'anon'})]);
  await db.exec('set role anon');
};
let checks=0;
const check=async(name,run)=>{await run();checks++;console.log('PASS '+name);};
const value=async(sql,params=[])=>{const result=await db.query(sql,params);return Object.values(result.rows[0]??{})[0];};
const reject=async(sql,params=[])=>assert.rejects(()=>db.query(sql,params));
await check('all public tables enable RLS',async()=>{
  assert.equal(await value("select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity"),0);
});
await actAs(owner,'aal1');
await check('owner signed in by email link (AAL1) has owner access',async()=>{
  assert.equal(await value('select count(*)::int from public.get_my_profile()'),1);
  assert.equal(await value('select count(*)::int from public.settings'),1);
});
await actAs(owner);
let lead;
await check('owner creates contact, business, deal, activity and task atomically',async()=>{
  lead=await value('select public.create_lead($1::jsonb)',[JSON.stringify({name:'Alex Example',email:'alex@example.com',phone_e164:'+61491570156',business_name:'Example Electrical',trade:'Electrician',channel:'manual'})]);
  assert.ok(lead.deal_id);
  assert.equal(await value('select count(*)::int from public.tasks where deal_id=$1',[lead.deal_id]),1);
  assert.equal(await value('select count(*)::int from public.activities where deal_id=$1',[lead.deal_id]),1);
});
await check('normalised phone matches existing open deal without double entry',async()=>{
  const duplicate=await value('select public.create_lead($1::jsonb)',[JSON.stringify({name:'Alex',phone_e164:'+61491570156'})]);
  assert.equal(duplicate.deal_id,lead.deal_id);assert.equal(duplicate.duplicate,true);
  assert.equal(await value('select count(*)::int from public.contacts'),1);
  assert.equal(await value('select "returning" from public.deals where id=$1',[lead.deal_id]),true);
});
await check('quote and won guards cannot be bypassed by direct updates',async()=>{
  await reject("update public.deals set stage_key='quote' where id=$1",[lead.deal_id]);
  await reject("update public.deals set outcome='won' where id=$1",[lead.deal_id]);
  await reject("select public.move_deal_stage($1,'won')",[lead.deal_id]);
});
await check('first milestone survives a backwards stage move',async()=>{
  await db.query("select public.move_deal_stage($1,'suitable')",[lead.deal_id]);
  const initial=await value("select first_reached_at::text from public.deal_milestones where deal_id=$1 and milestone_key='suitable'",[lead.deal_id]);
  await db.query("select public.move_deal_stage($1,'new')",[lead.deal_id]);
  await db.query("select public.move_deal_stage($1,'suitable')",[lead.deal_id]);
  assert.equal(await value("select first_reached_at::text from public.deal_milestones where deal_id=$1 and milestone_key='suitable'",[lead.deal_id]),initial);
});
await check('call logging writes first touch and dated follow-up',async()=>{
  await db.query("select public.log_call($1,'no_answer','Tried once','Call tomorrow',$2::timestamptz)",[lead.deal_id,'2026-11-05T22:30:00Z']);
  assert.ok(await value('select first_touch_at from public.deals where id=$1',[lead.deal_id]));
  assert.equal(await value("select count(*)::int from public.tasks where deal_id=$1 and title='Call tomorrow'",[lead.deal_id]),1);
});
await check('owner manual win records a reason',async()=>{
  await db.query("select public.move_deal_stage($1,'won','Signed agreement received outside CRM')",[lead.deal_id]);
  assert.equal(await value('select outcome from public.deals where id=$1',[lead.deal_id]),'won');
});
await check('audit diffs do not contain contact values',async()=>{
  const diffs=JSON.stringify((await db.query('select diff from public.audit_log')).rows);
  assert.ok(!diffs.includes('alex@example.com'));assert.ok(!diffs.includes('+61491570156'));
});
await actAs(staff);
await check('staff reads leads but not settings or invoices',async()=>{
  assert.equal(await value('select count(*)::int from public.deals'),1);
  assert.equal(await value('select count(*)::int from public.settings'),0);
  assert.equal(await value('select count(*)::int from public.invoices'),0);
  await reject("insert into public.invoices(number,due_on) values('DENIED',current_date)");
});
await check('staff cannot escalate role, delete or override a win',async()=>{
  await db.query("update public.profiles set role='owner' where user_id=$1",[staff]);
  assert.equal(await value('select role from public.profiles where user_id=$1',[staff]),'staff');
  await reject('update public.deals set deleted_at=now() where id=$1',[lead.deal_id]);
  await reject('delete from public.deals where id=$1',[lead.deal_id]);
  await reject("select public.move_deal_stage($1,'won','Pretending to be owner')",[lead.deal_id]);
});
await check('safe configuration excludes bank and integrations',async()=>{
  const config=await value('select public.get_configuration()');
  assert.ok(config.sales_stages);assert.equal(config.invoices,undefined);assert.equal(config.capi,undefined);
});
await check('STOP records consent, cancels drafts, prevents clearing opt-out',async()=>{
  await db.query("insert into public.message_drafts(contact_id,deal_id,channel,body) values($1,$2,'sms','Draft')",[lead.contact_id,lead.deal_id]);
  await db.query("select public.record_consent($1,'sms','opt_out','sms','STOP')",[lead.contact_id]);
  assert.ok(await value('select sms_opt_out_at from public.contacts where id=$1',[lead.contact_id]));
  assert.equal(await value('select status from public.message_drafts where contact_id=$1',[lead.contact_id]),'cancelled');
  await reject('update public.contacts set sms_opt_out_at=null where id=$1',[lead.contact_id]);
});
await actAs(viewer);
await check('viewer reads but cannot mutate',async()=>{
  assert.equal(await value('select count(*)::int from public.deals'),1);
  await reject("insert into public.tasks(title) values('Not allowed')");
  await reject('select public.create_lead($1::jsonb)',[JSON.stringify({name:'No',email:'no@example.com'})]);
  await reject("select public.log_call($1,'reached')",[lead.deal_id]);
});
await actAs(outsider);
await check('uninvited user sees no CRM rows',async()=>{
  assert.equal(await value('select count(*)::int from public.deals'),0);
  await reject('select public.accept_invitation()');
});
await service();
await check('service attribution cannot be edited by an owner',async()=>{
  const imported=await value('select public.create_lead($1::jsonb)',[JSON.stringify({name:'Pat Example',email:'pat@example.com',channel:'website',attribution:{utm_campaign:'test',raw:{name:'Pat Example'}}})]);
  await actAs(owner);
  await db.query("update public.attribution set utm_campaign='changed' where deal_id=$1",[imported.deal_id]);
  assert.equal(await value('select utm_campaign from public.attribution where deal_id=$1',[imported.deal_id]),'test');
});
if(includePhase2) {
await service();
let inbound;
await check('ingest idempotency returns one deal and one notification',async()=>{
  const payload=JSON.stringify({first_name:'Sam',phone_e164:'+61491570157',business:'Example Plumbing',attribution:{utm_campaign:'fictional',raw:{name:'Sam'}},promised_text:'Tomorrow',promised_due_at:'2026-11-05T04:30:00Z'});
  inbound=await value("select public.ingest_lead('website','event-test',$1::jsonb)",[payload]);
  const duplicate=await value("select public.ingest_lead('website','event-test',$1::jsonb)",[payload]);
  assert.equal(inbound.duplicate,false);assert.equal(duplicate.duplicate,true);assert.equal(duplicate.deal_id,inbound.deal_id);
  assert.equal(await value("select count(*)::int from public.notifications_log where event_key=$1",['new_lead:'+inbound.deal_id]),1);
  assert.equal(await value('select count(*)::int from public.activities where deal_id=$1',[inbound.deal_id]),1);
});
await check('second enquiry attaches to open deal and preserves attribution',async()=>{
  const followup=await value("select public.ingest_lead('website','event-test-2',$1::jsonb)",[JSON.stringify({first_name:'Sam',phone_e164:'+61491570157',attribution:{utm_campaign:'must-not-replace'}})]);
  assert.equal(followup.deal_id,inbound.deal_id);assert.equal(followup.duplicate,false);
  assert.equal(await value('select utm_campaign from public.attribution where deal_id=$1',[inbound.deal_id]),'fictional');
});
await check('Chloe outbound stamps first touch and booking is idempotent',async()=>{
  const event={phone:'+61491570157',at:'2026-11-04T05:07:47Z',type:'message_out',text:'Hello'};
  await db.query('select public.ingest_chloe($1,$2::jsonb)',['chloe:out-test',JSON.stringify(event)]);
  assert.ok(await value('select first_touch_at from public.deals where id=$1',[inbound.deal_id]));
  const booking={...event,type:'booked',call_time:'2026-11-05T00:30:00Z',fields:{trade:'Plumber',goals:'A clear website'}};
  await db.query('select public.ingest_chloe($1,$2::jsonb)',['chloe:booking-test',JSON.stringify(booking)]);
  await db.query('select public.ingest_chloe($1,$2::jsonb)',['chloe:booking-test',JSON.stringify(booking)]);
  assert.equal(await value('select stage_key from public.deals where id=$1',[inbound.deal_id]),'call_booked');
  assert.equal(await value('select count(*)::int from public.appointments where deal_id=$1',[inbound.deal_id]),1);
  assert.equal(await value("select count(*)::int from public.tasks where deal_id=$1 and rule_key='call_prep'",[inbound.deal_id]),1);
});
await check('message reservation is idempotent and STOP blocks sending',async()=>{
  await actAs(owner);
  const sendId='00000000-0000-4000-8000-000000000050';
  const reserved=await value("select public.prepare_message($1,'sms','Hello, Troy from Lumen. Reply STOP to opt out.','',$2)",[inbound.deal_id,sendId]);
  assert.equal(reserved.duplicate,false);
  assert.equal((await value("select public.prepare_message($1,'sms','Hello','',$2)",[inbound.deal_id,sendId])).duplicate,true);
  await db.query("select public.finalise_message($1,'sent','fictional-provider-id')",[reserved.activity_id]);
  await service();
  await db.query('select public.ingest_chloe($1,$2::jsonb)',['chloe:stop-test',JSON.stringify({phone:'+61491570157',at:'2026-11-04T05:08:47Z',type:'message_in',text:'STOP'})]);
  assert.equal(await value('select chloe_status from public.deals where id=$1',[inbound.deal_id]),'stopped');
  await actAs(owner);
  await reject("select public.prepare_message($1,'sms','Cannot send','',$2)",[inbound.deal_id,'00000000-0000-4000-8000-000000000051']);
});
await service();
await check('persistent rate limiter enforces its limit',async()=>{
  assert.equal(await value("select public.consume_rate_limit('fixture-source',2,60)"),true);
  assert.equal(await value("select public.consume_rate_limit('fixture-source',2,60)"),true);
  assert.equal(await value("select public.consume_rate_limit('fixture-source',2,60)"),false);
});
await actAs(staff);
await check('ingest RPCs are not callable by app users',async()=>{
  await reject("select public.ingest_lead('website','forged','{}')");
  await reject("select public.consume_rate_limit('forged',100,60)");
});
await actAs(owner);
await check('atomic deal patch rejects unsupported data and keeps its transaction',async()=>{
  await reject('select public.patch_deal($1,$2::jsonb)',[inbound.deal_id,JSON.stringify({stage_key:'quote',next_step:'Should not persist'})]);
  assert.notEqual(await value('select next_step from public.deals where id=$1',[inbound.deal_id]),'Should not persist');
  await reject('select public.patch_deal($1,$2::jsonb)',[inbound.deal_id,JSON.stringify({created_at:'2000-01-01'})]);
});
await check('merge preserves both timelines and earliest milestone',async()=>{
  const extra=await value('select public.create_lead($1::jsonb)',[JSON.stringify({name:'Merge Example',email:'merge@example.com'})]);
  await db.query("select public.move_deal_stage($1,'suitable')",[extra.deal_id]);
  const before=await value('select count(*)::int from public.activities where deal_id in ($1,$2)',[inbound.deal_id,extra.deal_id]);
  await db.query('select public.merge_deals($1,$2)',[inbound.deal_id,extra.deal_id]);
  assert.ok(await value('select deleted_at from public.deals where id=$1',[extra.deal_id]));
  assert.equal(await value('select merged_into_id from public.deals where id=$1',[extra.deal_id]),inbound.deal_id);
  assert.equal(await value('select count(*)::int from public.activities where deal_id=$1',[inbound.deal_id]),before+1);
  assert.equal(await value("select count(*)::int from public.deal_milestones where deal_id=$1 and milestone_key='suitable'",[inbound.deal_id]),1);
});
if(migrationFiles.some(f=>f.includes('006_calendar'))) {
await check('private calendar capability is revocable and invalid tokens reveal nothing',async()=>{
  const hash='a'.repeat(64);
  await db.query('insert into public.calendar_tokens(user_id,token_hash) values($1,$2)',[owner,hash]);
  await anonymous();
  assert.equal(await value("select public.calendar_feed('invalid')"),null);
  assert.ok(Array.isArray(await value('select public.calendar_feed($1)',[hash])));
  await actAs(owner);
  await db.query('update public.calendar_tokens set revoked_at=now() where token_hash=$1',[hash]);
  await anonymous();
  assert.equal(await value('select public.calendar_feed($1)',[hash]),null);
});
}
}
let commerceFixture=null;
if(migrationFiles.some(f=>f.includes('005_commerce'))) {
await actAs(owner);
let quote, invoiceId, projectId;
await check('quote maths separates once, monthly and included items',async()=>{
  const deal=await value('select public.create_lead($1::jsonb)',[JSON.stringify({name:'Jordan Example',email:'jordan@example.com',business:'Example Carpentry'})]);
  quote=await value('select to_jsonb(public.create_quote($1,$2::jsonb))',[deal.deal_id,JSON.stringify([
    {description:'Website',qty:1,unit_price:2200,kind:'once'},
    {description:'Hosting and maintenance',qty:1,unit_price:49,kind:'monthly'},
    {description:'First 3 months local SEO',qty:1,unit_price:600,kind:'once',included:true}
  ])]);
  assert.equal(Number(quote.total_once),2200);assert.equal(Number(quote.total_monthly),49);
  assert.equal(quote.public_token.length,43);
  await reject('select public.issue_quote($1)',[quote.id]);
  await db.query("update public.settings set config=jsonb_set(config,'{quotes}',(config->'quotes')||$1::jsonb)",[JSON.stringify({terms_url:'https://example.com/terms',deposit_percentage:50})]);
  quote=await value('select to_jsonb(public.issue_quote($1))',[quote.id]);
  await reject("update public.quote_items set unit_price=1 where quote_id=$1",[quote.id]);
});
await check('public quote reveals only its capability data',async()=>{
  await anonymous();
  await reject('select * from public.contacts');
  await reject('select public.public_quote($1)',['b'.repeat(43)]);
  const safe=await value('select public.public_quote($1)',[quote.public_token]);
  assert.equal(safe.business_name,'Example Carpentry');
  assert.equal(safe.deal_id,undefined);assert.equal(safe.accepted_ip,undefined);
  assert.equal(safe.items.length,3);
  await db.query('select public.record_quote_view($1)',[quote.public_token]);
});
await check('quote acceptance atomically wins, creates checklist, deposit and notification',async()=>{
  await reject('select public.accept_quote($1,$2,false)',[quote.public_token,'Jordan Example']);
  const accepted=await value('select public.accept_quote($1,$2,true,$3::inet,$4)',[quote.public_token,'Jordan Example','192.0.2.10','Fictional browser']);
  invoiceId=accepted.invoice_id;projectId=accepted.project_id;
  assert.equal(accepted.already_accepted,false);
  const duplicate=await value('select public.accept_quote($1,$2,true)',[quote.public_token,'Jordan Example']);
  assert.equal(duplicate.already_accepted,true);assert.equal(duplicate.project_id,projectId);
  await actAs(owner);
  assert.equal(await value('select outcome from public.deals where id=$1',[quote.deal_id]),'won');
  assert.equal(await value('select count(*)::int from public.checklist_items where project_id=$1',[projectId]),16);
  assert.equal(Number(await value('select total from public.invoices where id=$1',[invoiceId])),1100);
  assert.equal(await value('select accepted_ip::text from public.quotes where id=$1',[quote.id]),'192.0.2.10/32');
  assert.equal(await value("select count(*)::int from public.notifications_log where event_key=$1",['quote_accepted:'+quote.id]),1);
  assert.equal(await value('select count(*)::int from public.invoices where deal_id=$1',[quote.deal_id]),1);
  assert.equal(await value("select billing_snapshot ? 'bank_details' from public.invoices where id=$1",[invoiceId]),false);
  commerceFixture={quote,invoiceId,projectId,contactId:await value('select contact_id from public.deals where id=$1',[quote.deal_id])};
});
await check('payments are partial then paid, with overpayments blocked',async()=>{
  await db.query("select public.record_payment($1,400,current_date,'bank_transfer','First part')",[invoiceId]);
  assert.equal(await value('select status from public.invoices where id=$1',[invoiceId]),'part_paid');
  await reject('select public.record_payment($1,701)',[invoiceId]);
  await db.query('select public.record_payment($1,700)',[invoiceId]);
  assert.equal(await value('select status from public.invoices where id=$1',[invoiceId]),'paid');
  assert.ok(await value('select paid_at from public.invoices where id=$1',[invoiceId]));
});
await check('invoice sequence is transactional and GST preserves full prices',async()=>{
  await db.query("update public.settings set config=jsonb_set(config,'{gst,registered}','true')");
  const invoice=await value('select to_jsonb(public.create_invoice($1::jsonb))',[JSON.stringify({items:[{description:'Service',qty:1,unit_price:110}]})]);
  assert.equal(invoice.number,'LUM-0002');assert.equal(Number(invoice.subtotal),100);assert.equal(Number(invoice.gst),10);assert.equal(Number(invoice.total),110);
});
await check('project launch starts one subscription and schedules SEO and permission tasks',async()=>{
  await actAs(staff);
  await db.query('select public.launch_project($1,$2)',[projectId,'https://example.com']);
  await db.query('select public.launch_project($1,$2)',[projectId,'https://example.com']);
  assert.equal(await value("select count(*)::int from public.activities where type='payment'"),0);
  await actAs(owner);
  assert.equal(await value('select count(*)::int from public.subscriptions'),1);
  assert.equal(await value("select count(*)::int from public.tasks where project_id=$1 and rule_key like 'local_seo_%'",[projectId]),3);
  assert.equal(await value("select count(*)::int from public.tasks where project_id=$1 and rule_key='feature_permission'",[projectId]),1);
});
await check('quote invoicing cannot duplicate deposit or balance',async()=>{
  await reject("select public.invoice_from_quote($1,'deposit')",[quote.id]);
  const balance=await value("select to_jsonb(public.invoice_from_quote($1,'balance'))",[quote.id]);
  assert.equal(Number(balance.total),1100);
  await reject("select public.invoice_from_quote($1,'balance')",[quote.id]);
});
await check('invoice email reservation enforces consent and staff isolation',async()=>{
  await reject("select public.prepare_invoice_message($1,$2,'Invoice attached','Invoice')",[invoiceId,'00000000-0000-4000-8000-000000000070']);
  await db.query("select public.record_consent($1,'email','opt_in','manual','Client asked for their invoice by email')",[commerceFixture.contactId]);
  const reserved=await value("select public.prepare_invoice_message($1,$2,'Invoice attached','Invoice')",[invoiceId,'00000000-0000-4000-8000-000000000070']);
  assert.equal(reserved.email,'jordan@example.com');
  assert.equal((await value("select public.prepare_invoice_message($1,$2,'Invoice attached','Invoice')",[invoiceId,'00000000-0000-4000-8000-000000000070'])).duplicate,true);
  await actAs(staff);
  assert.equal(await value('select count(*)::int from public.activities where id=$1',[reserved.activity_id]),0);
  await reject("select public.finalise_message($1,'sent')",[reserved.activity_id]);
  await actAs(owner);
});
}
if(migrationFiles.some(f=>f.includes('007_jobs'))) {
await service();
await check('job lease prevents duplicates and completed work stays complete',async()=>{
  assert.equal(await value("select public.claim_job('test-job','fixture')"),true);
  assert.equal(await value("select public.claim_job('test-job','fixture')"),false);
  await db.query("select public.finish_job('test-job','failed','test_failure')");
  assert.equal(await value("select public.claim_job('test-job','fixture')"),true);
  await db.query("select public.finish_job('test-job','done')");
  assert.equal(await value("select public.claim_job('test-job','fixture')"),false);
});
await check('automation tasks without deals are idempotent',async()=>{
  const input=JSON.stringify({title:'Review overdue invoice',rule_key:'invoice_overdue:fixture'});
  assert.equal(await value('select public.ensure_task($1::jsonb)',[input]),await value('select public.ensure_task($1::jsonb)',[input]));
});
await check('CAPI off prevents claims; stable event ids deduplicate',async()=>{
  const eventId='crm:'+lead.deal_id+':suitable';
  await db.query("insert into public.capi_outbox(deal_id,event_name,event_id,payload) values($1,'QualifiedLead',$2,$3::jsonb)",[lead.deal_id,eventId,JSON.stringify({user_data:{em:['fictionalhash']}})]);
  await reject("insert into public.capi_outbox(deal_id,event_name,event_id,payload) values($1,'QualifiedLead',$2,'{}')",[lead.deal_id,eventId]);
  assert.equal(await value('select count(*)::int from public.claim_capi()'),0);
  await db.query("update public.settings set config=jsonb_set(config,'{capi,enabled}','true')");
  assert.equal(await value('select count(*)::int from public.claim_capi()'),1);
  assert.equal(await value('select count(*)::int from public.claim_capi()'),0);
  await db.query("update public.settings set config=jsonb_set(config,'{capi,enabled}','false')");
});
}
if(migrationFiles.some(f=>f.includes('008_privacy'))) {
await actAs(owner);
await check('anonymisation removes PII, revokes quote and retains aggregate facts',async()=>{
  const {quote,contactId,projectId}=commerceFixture;
  const before=await value('select count(*)::int from public.deal_milestones where deal_id=$1',[quote.deal_id]);
  await db.query("insert into public.files(entity,entity_id,path,name,mime,size) values('contact',$1,$2,'Jordan photo.jpg','image/jpeg',100)",[contactId,'contact/'+contactId+'/photo.jpg']);
  await db.query('select public.anonymise_contact($1)',[contactId]);
  const contact=(await db.query('select first_name,email,phone_e164,anonymised_at from public.contacts where id=$1',[contactId])).rows[0];
  assert.equal(contact.first_name,'Deleted person');assert.equal(contact.email,null);assert.equal(contact.phone_e164,null);assert.ok(contact.anonymised_at);
  assert.equal(await value('select count(*)::int from public.deal_milestones where deal_id=$1',[quote.deal_id]),before);
  assert.equal(Number(await value('select value_once from public.deals where id=$1',[quote.deal_id])),2200);
  assert.ok(await value('select anonymised_at from public.deals where id=$1',[quote.deal_id]));
  assert.equal(await value('select accepted_ip from public.quotes where id=$1',[quote.id]),null);
  assert.equal(await value('select accepted_name from public.quotes where id=$1',[quote.id]),null);
  assert.equal(await value('select name from public.projects where id=$1',[projectId]),'Anonymised project');
  await reject("select public.restore_deleted('contacts',$1)",[contactId]);
  await anonymous();
  await reject('select public.public_quote($1)',[quote.public_token]);
  await service();
  assert.equal(await value('select count(*)::int from public.storage_deletions where path=$1',['contact/'+contactId+'/photo.jpg']),1);
});
await check('retention selects only old lost/no-reply contacts and protects customers',async()=>{
  const old=await value('select public.create_lead($1::jsonb)',[JSON.stringify({name:'Old Example',email:'old@example.com',received_at:'2020-01-01T00:00:00Z'})]);
  await db.query("update public.deals set outcome='lost',closed_at='2020-02-01T00:00:00Z' where id=$1",[old.deal_id]);
  const candidates=(await db.query("select public.retention_candidates(now()-interval '24 months') id")).rows.map(r=>r.id);
  assert.ok(candidates.includes(old.contact_id));assert.ok(!candidates.includes(lead.contact_id));
  await reject("select public.retention_candidates(now()-interval '1 month')");
});
await check('bin restore is owner-only and expires after 30 days',async()=>{
  await actAs(owner);
  const taskId=await value("insert into public.tasks(title,deleted_at) values('Restore fixture',now()) returning id");
  await actAs(staff);
  await reject("select public.restore_deleted('tasks',$1)",[taskId]);
  await actAs(owner);
  await db.query("select public.restore_deleted('tasks',$1)",[taskId]);
  assert.equal(await value('select deleted_at from public.tasks where id=$1',[taskId]),null);
  await db.query("update public.tasks set deleted_at=now()-interval '31 days' where id=$1",[taskId]);
  await reject("select public.restore_deleted('tasks',$1)",[taskId]);
});
}
if(migrationFiles.some(f=>f.includes('009_data'))) {
await actAs(owner);
await check('settings revisions prevent stale saves and preserve billing counters',async()=>{
  const current=(await db.query('select * from public.settings')).rows[0];
  const stale={...current.config,invoices:{...current.config.invoices,next_number:1},quotes:{...current.config.quotes,next_number:1},speed_to_lead_minutes:6};
  const saved=await value('select to_jsonb(public.save_settings($1::jsonb,$2))',[JSON.stringify(stale),current.revision]);
  assert.equal(Number(saved.revision),Number(current.revision)+1);
  assert.equal(saved.config.invoices.next_number,current.config.invoices.next_number);
  assert.equal(saved.config.quotes.next_number,current.config.quotes.next_number);
  await reject('select public.save_settings($1::jsonb,$2)',[JSON.stringify(stale),current.revision]);
});
await check('settings preserve canonical stage keys while configured custom stages work',async()=>{
  const current=(await db.query('select * from public.settings')).rows[0];
  const missing={...current.config,sales_stages:current.config.sales_stages.filter(stage=>stage.key!=='quote')};
  await reject('select public.save_settings($1::jsonb,$2)',[JSON.stringify(missing),current.revision]);
  const duplicate={...current.config,sales_stages:[...current.config.sales_stages,{key:'new',label:'Duplicate'}]};
  await reject('select public.save_settings($1::jsonb,$2)',[JSON.stringify(duplicate),current.revision]);
  const custom={...current.config,sales_stages:[...current.config.sales_stages,{key:'awaiting_photos',label:'Awaiting photos'}]};
  await db.query('select public.save_settings($1::jsonb,$2)',[JSON.stringify(custom),current.revision]);
  const lead=await value('select public.create_lead($1::jsonb)',[JSON.stringify({name:'Custom Stage',email:'custom-stage@example.com'})]);
  await db.query("select public.move_deal_stage($1,'awaiting_photos')",[lead.deal_id]);
  assert.equal(await value('select stage_key from public.deals where id=$1',[lead.deal_id]),'awaiting_photos');
  await reject("select public.move_deal_stage($1,'not_configured')",[lead.deal_id]);
});
await check('CSV row receipts prevent duplicate contact and timeline on retry',async()=>{
  const batchId='00000000-0000-4000-8000-000000000080',contentHash='c'.repeat(64),rowHash='d'.repeat(64);
  await db.query("select public.prepare_import_batch($1,$2,'deals',1)",[batchId,contentHash]);
  const row=JSON.stringify({first_name:'Import',last_name:'Example',email:'import@example.com',entity:'deals',stage_key:'contacted',outcome:'open',channel:'manual'});
  const first=await value('select public.import_lead_row($1,2,$2,$3::jsonb)',[batchId,rowHash,row]);
  const before=await value('select count(*)::int from public.activities where deal_id=$1',[first.deal_id]);
  const retry=await value('select public.import_lead_row($1,2,$2,$3::jsonb)',[batchId,rowHash,row]);
  assert.equal(retry.skipped,true);assert.equal(retry.deal_id,first.deal_id);
  assert.equal(await value('select count(*)::int from public.activities where deal_id=$1',[first.deal_id]),before);
  assert.equal(await value('select status from public.import_batches where id=$1',[batchId]),'complete');
  await reject('select public.import_lead_row($1,2,$2,$3::jsonb)',[batchId,'e'.repeat(64),row]);
  await reject("select public.prepare_import_batch($1,$2,'deals',1)",[batchId,'f'.repeat(64)]);
});
await check('contact CSV import creates no deal and matches email without overwriting',async()=>{
  const batchId='00000000-0000-4000-8000-000000000081';
  await db.query("select public.prepare_import_batch($1,$2,'contacts',2)",[batchId,'f'.repeat(64)]);
  const before=await value('select count(*)::int from public.deals');
  const rows=await value('select public.import_lead_rows($1,$2::jsonb)',[batchId,JSON.stringify([
    {row:2,hash:'a'.repeat(64),input:{first_name:'Contact only',email:'contactonly@example.com'}},
    {row:3,hash:'b'.repeat(64),input:{first_name:'Different',email:'CONTACTONLY@EXAMPLE.COM'}}
  ])]);
  assert.equal(rows[0].contact_id,rows[1].contact_id);assert.equal(rows[1].duplicate,true);
  assert.equal(await value('select count(*)::int from public.deals'),before);
  assert.equal(await value('select first_name from public.contacts where id=$1',[rows[0].contact_id]),'Contact only');
});
await check('CSV batch is owner only at the database boundary',async()=>{
  await actAs(staff);
  await reject("select public.prepare_import_batch($1,$2,'contacts',1)",['00000000-0000-4000-8000-000000000082','a'.repeat(64)]);
  assert.equal(await value('select count(*)::int from public.import_batches'),0);
  await actAs(owner);
});
await check('storage cannot bypass deleted or financial file metadata for staff',async()=>{
  const path='deal/'+lead.deal_id+'/example.pdf';
  const fileId=await value("insert into public.files(entity,entity_id,path,name,mime,size) values('deal',$1,$2,'Example.pdf','application/pdf',100) returning id",[lead.deal_id,path]);
  await db.query("insert into storage.objects(bucket_id,name) values('crm-files',$1)",[path]);
  await actAs(staff);
  assert.equal(await value('select count(*)::int from storage.objects where name=$1',[path]),1);
  await actAs(owner);
  await db.query('update public.files set deleted_at=now() where id=$1',[fileId]);
  await actAs(staff);
  assert.equal(await value('select count(*)::int from storage.objects where name=$1',[path]),0);
  await actAs(owner);
  await db.query("update public.files set deleted_at=null,entity='invoice' where id=$1",[fileId]);
  await actAs(staff);
  assert.equal(await value('select count(*)::int from storage.objects where name=$1',[path]),0);
  await actAs(owner);
});
await check('file cleanup retries retain original queued paths after anonymisation',async()=>{
  const person=await value('select public.create_lead($1::jsonb)',[JSON.stringify({name:'File Example',email:'fileperson@example.com'})]);
  const path='contact/'+person.contact_id+'/attachment.pdf';
  await db.query("insert into public.files(entity,entity_id,path,name,mime,size) values('contact',$1,$2,'Attachment.pdf','application/pdf',100)",[person.contact_id,path]);
  await db.query('select public.anonymise_contact($1)',[person.contact_id]);
  assert.ok((await value('select public.person_storage_paths($1)',[person.contact_id])).includes(path));
  await db.query('select public.mark_storage_deleted($1::text[])',[[path]]);
  assert.ok(!(await value('select public.person_storage_paths($1)',[person.contact_id])).includes(path));
});
await check('pending storage objects are private to their uploader and cancellation queues cleanup after token expiry',async()=>{
  const path='deal/'+lead.deal_id+'/pending.pdf';
  const fileId=await value("insert into public.files(entity,entity_id,path,name,mime,size,upload_status,uploaded_by) values('deal',$1,$2,'Pending.pdf','application/pdf',100,'pending',public.current_profile_id()) returning id",[lead.deal_id,path]);
  await db.query("insert into storage.objects(bucket_id,name) values('crm-files',$1)",[path]);
  await actAs(viewer);
  assert.equal(await value('select count(*)::int from storage.objects where name=$1',[path]),0);
  await actAs(staff);
  assert.equal(await value('select count(*)::int from storage.objects where name=$1',[path]),0);
  await reject("insert into storage.objects(bucket_id,name) values('crm-files',$1)",['deal/'+lead.deal_id+'/unprepared.pdf']);
  await actAs(owner);
  await db.query('update public.files set uploaded_by=(select id from public.profiles where user_id=$1) where id=$2',[staff,fileId]);
  await actAs(staff);
  assert.equal(await value('select count(*)::int from storage.objects where name=$1',[path]),1);
  await db.query('select public.cancel_file_upload($1)',[fileId]);
  assert.equal(await value('select count(*)::int from storage.objects where name=$1',[path]),0);
  await actAs(owner);
  assert.equal(await value('select upload_status from public.files where id=$1',[fileId]),'failed');
  await service();
  assert.equal(await value('select count(*)::int from public.storage_deletions where path=$1 and done_at is null and delete_after>now()',[path]),1);
  await actAs(owner);
});
await check('a forged file entity cannot grant access to a financial storage path',async()=>{
  const path='invoice/'+lead.deal_id+'/protected.pdf';
  await db.query("insert into public.files(entity,entity_id,path,name,mime,size) values('deal',$1,$2,'Forged.pdf','application/pdf',100)",[lead.deal_id,path]);
  await db.query("insert into storage.objects(bucket_id,name) values('crm-files',$1)",[path]);
  await actAs(staff);
  assert.equal(await value('select count(*)::int from storage.objects where name=$1',[path]),0);
  await actAs(owner);
});
await check('viewer reports retain anonymous historical facts without personal fields',async()=>{
  await actAs(viewer);
  assert.ok(await value('select count(*)::int from public.deals where anonymised_at is not null')>0);
  assert.equal(await value('select count(*)::int from public.contacts where anonymised_at is not null and (email is not null or phone_e164 is not null)'),0);
  await actAs(owner);
});
await check('invoice sequence keeps digits beyond four places',async()=>{
  await db.query("update public.settings set config=jsonb_set(config,'{invoices,next_number}','10000')");
  const invoice=await value('select to_jsonb(public.create_invoice($1::jsonb))',[JSON.stringify({items:[{description:'Sequence test',qty:1,unit_price:10}]})]);
  assert.equal(invoice.number,'LUM-10000');
});
await check('expanded privacy redacts quote snapshots and business-only delivery and billing text',async()=>{
  const person=await value('select public.create_lead($1::jsonb)',[JSON.stringify({name:'Private Sentinel',email:'privacy-graph@example.com',business:'Private Sentinel Co',trade:'Plumber',channel:'referral',value_once:1234})]);
  const project=await value("insert into public.projects(business_id,name,template_key) values($1,'Private Sentinel project','private_sentinel') returning id",[person.business_id]);
  await db.query("insert into public.checklist_items(project_id,section,title) values($1,'Private Sentinel section','Private Sentinel item')",[project]);
  const task=await value("insert into public.tasks(project_id,title,notes) values($1,'Private Sentinel task','Private Sentinel note') returning id",[project]);
  const subscription=await value("insert into public.subscriptions(business_id,price,billing_day,status_reason) values($1,49,1,'Private Sentinel cancellation') returning id",[person.business_id]);
  const invoice=await value('select to_jsonb(public.create_invoice($1::jsonb))',[JSON.stringify({business_id:person.business_id,subscription_id:subscription,notes:'Private Sentinel billing',items:[{description:'Private Sentinel invoice item',qty:1,unit_price:2200}]})]);
  await db.query("update public.invoices set gst_wording='Private Sentinel wording' where id=$1",[invoice.id]);
  await db.query("insert into public.payments(invoice_id,amount,method,reference) values($1,100,'Private Sentinel method','Private Sentinel reference')",[invoice.id]);
  let quote=await value('select to_jsonb(public.create_quote($1,$2::jsonb))',[person.deal_id,JSON.stringify([{description:'Private Sentinel quote',qty:1,unit_price:2200}])]);
  quote=await value('select to_jsonb(public.issue_quote($1))',[quote.id]);
  await service();
  await db.query("update public.quotes set terms_url='https://example.com/private-sentinel',terms_snapshot=jsonb_set(terms_snapshot,'{items}', $2::jsonb) where id=$1",[quote.id,JSON.stringify([{included_details:['Private Sentinel included detail']}])]);
  await actAs(owner);
  const filePath='invoice/'+invoice.id+'/private.pdf';
  await db.query("insert into public.files(entity,entity_id,path,name,mime,size) values('invoice',$1,$2,'Private Sentinel file.pdf','application/pdf',100)",[invoice.id,filePath]);
  const tag=await value("insert into public.tags(name) values('Private Sentinel tag') returning id");
  await db.query("insert into public.taggings(tag_id,entity,entity_id) values($1,'contact',$2)",[tag,person.contact_id]);
  assert.ok((await value('select public.person_storage_paths($1)',[person.contact_id])).includes(filePath));
  await db.query('select public.anonymise_contact($1)',[person.contact_id]);
  assert.deepEqual(await value('select terms_snapshot from public.quotes where id=$1',[quote.id]),{});
  assert.equal(await value('select terms_url from public.quotes where id=$1',[quote.id]),null);
  assert.equal(await value('select section from public.checklist_items where project_id=$1',[project]),'Archived');
  assert.equal(await value('select template_key from public.projects where id=$1',[project]),'archived');
  assert.equal(await value('select notes from public.tasks where id=$1',[task]),null);
  assert.ok(await value('select done_at from public.tasks where id=$1',[task]));
  assert.equal(await value('select status_reason from public.subscriptions where id=$1',[subscription]),null);
  assert.equal(await value('select notes from public.invoices where id=$1',[invoice.id]),null);
  assert.equal(await value('select gst_wording from public.invoices where id=$1',[invoice.id]),null);
  assert.equal(await value('select method from public.payments where invoice_id=$1',[invoice.id]),'other');
  assert.equal(Number(await value('select total from public.invoices where id=$1',[invoice.id])),2200);
  assert.equal(Number(await value('select total_once from public.quotes where id=$1',[quote.id])),2200);
  assert.equal(await value('select trade from public.businesses where id=$1',[person.business_id]),'Plumber');
  assert.equal(await value('select channel from public.deals where id=$1',[person.deal_id]),'referral');
  assert.equal(await value('select count(*)::int from public.taggings where entity_id=$1',[person.contact_id]),0);
  assert.ok((await value('select name from public.tags where id=$1',[tag])).startsWith('Archived tag'));
  assert.ok((await value('select public.person_storage_paths($1)',[person.contact_id])).includes(filePath));
  await db.query('select public.anonymise_contact($1)',[person.contact_id]);
  assert.equal(Number(await value('select total from public.invoices where id=$1',[invoice.id])),2200);
});
await check('person redaction preserves a business still used by another contact',async()=>{
  const person=await value('select public.create_lead($1::jsonb)',[JSON.stringify({name:'First Shared',email:'shared-first@example.com',business:'Shared Example Co'})]);
  const other=await value("insert into public.contacts(business_id,first_name,email) values($1,'Second Shared','shared-second@example.com') returning id",[person.business_id]);
  const project=await value("insert into public.projects(business_id,name) values($1,'Shared delivery') returning id",[person.business_id]);
  await db.query('select public.anonymise_contact($1)',[person.contact_id]);
  assert.equal(await value('select name from public.businesses where id=$1',[person.business_id]),'Shared Example Co');
  assert.equal(await value('select name from public.projects where id=$1',[project]),'Shared delivery');
  assert.equal(await value('select email from public.contacts where id=$1',[other]),'shared-second@example.com');
});
await check('safe configuration includes editable delivery stages',async()=>{
  await actAs(staff);
  const config=await value('select public.get_configuration()');
  assert.equal(config.delivery_stages.length,8);assert.equal(config.delivery_stages[0].key,'kickoff');
  await reject('select public.person_data_scope($1)',[lead.contact_id]);
  await actAs(owner);
  await reject('select public.contact_redaction_scope($1)',[lead.contact_id]);
});
}
if(migrationFiles.some(f=>f.includes('010_retention'))) {
await check('12-month migration updates the old default and preserves custom retention periods',async()=>{
  const migration=await readFile('supabase/migrations/202611040010_retention.sql','utf8');
  assert.equal(await value("select config->>'retention_months' from public.settings"),'12');
  await db.query("update public.settings set config=jsonb_set(config,'{retention_months}','24')");
  await db.exec('reset role');await db.exec(migration);await actAs(owner);
  assert.equal(await value("select config->>'retention_months' from public.settings"),'12');
  await db.query("update public.settings set config=jsonb_set(config,'{retention_months}','18')");
  await db.exec('reset role');await db.exec(migration);await actAs(owner);
  assert.equal(await value("select config->>'retention_months' from public.settings"),'18');
  await db.query("update public.settings set config=jsonb_set(config,'{retention_months}','12')");
});
await check('retention includes a 13-month closed lead and excludes recent or open leads',async()=>{
  await service();
  const old=await value('select public.create_lead($1::jsonb)',[JSON.stringify({name:'Retention Example',email:'retention-13@example.com'})]);
  await db.query("update public.deals set outcome='noreply',closed_at=now()-interval '13 months',created_at=now()-interval '14 months' where id=$1",[old.deal_id]);
  const candidates=(await db.query("select public.retention_candidates(now()-interval '12 months') id")).rows.map(r=>r.id);
  assert.ok(candidates.includes(old.contact_id));assert.ok(!candidates.includes(lead.contact_id));
  await reject("select public.retention_candidates(now()-interval '11 months')");
  await actAs(owner);
});
}
console.log('Database checks passed: '+checks);
await db.close();
