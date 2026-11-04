-- Prices and business rules live in editable data, not application constants.
insert into public.settings(config) values ($config${
  "business": {"trading_name":"Lumen adl","legal_name":"Troy Watson","abn":"","email":"","phone":"","address":""},
  "call_hours":{"days":[1,2,3,4,5],"start":"09:00","end":"17:00","holidays":[],"timeZone":"Australia/Adelaide","call_duration_minutes":15},
  "gst":{"registered":false,"rate":0.1,"wording":"No GST was charged."},
  "invoices":{"prefix":"LUM-","next_number":1,"payment_terms_days":14,"bank_details":{"account_name":"","bsb":"","account_number":""}},
  "quotes":{"prefix":"QUO-","next_number":1,"validity_days":30,"terms_url":"","deposit_percentage":null},
  "speed_to_lead_minutes":5,
  "digest_time":"07:30",
  "retention_months":12,
  "bin_retention_days":30,
  "ai_enabled":false,
  "sales_stages":[{"key":"new","label":"New"},{"key":"contacted","label":"Contacted"},{"key":"suitable","label":"Suitable"},{"key":"call_booked","label":"Call booked"},{"key":"brief","label":"Brief agreed"},{"key":"demo","label":"Demo sent"},{"key":"quote","label":"Quote sent"},{"key":"won","label":"Won"}],
  "delivery_stages":[{"key":"kickoff","label":"Kickoff"},{"key":"content","label":"Content in"},{"key":"design","label":"Design"},{"key":"build","label":"Build"},{"key":"review","label":"Review"},{"key":"launched","label":"Launched"},{"key":"local_seo","label":"Local SEO (months 1–3)"},{"key":"hosting","label":"Hosting"}],
  "lost_reasons":["Price","Timing","Went with someone else","Doing it themselves","Not a fit","Other"],
  "source_labels":{"tradie-websites-landing":"Tradie websites","tradie-landing":"Tradie websites","business-card":"Business card","contact":"Contact form","realestate-landing":"Real estate","dental-landing":"Dental","medical-landing":"Medical","law-firm-landing":"Law firms","law-firm-websites":"Law firms","allied-health-websites":"Allied health","local-seo-landing":"Local SEO","ai-automation-landing":"AI automation","southern-landing":"Southern Adelaide","regional-landing":"Regional SA"},
  "capi":{"enabled":false,"test_event_code":"","mapping":{"contacted":"TwoWayContact","suitable":"QualifiedLead","call_booked":"Schedule","demo":"DemoSent","quote":"QuoteSent","won":"Purchase"}},
  "project_templates":{
    "website":[{"section":"Kickoff","title":"Kickoff call"},{"section":"Content","title":"Logo, photos and copy received"},{"section":"Content","title":"Domain and DNS access"},{"section":"Design","title":"Homepage design approved"},{"section":"Build","title":"Pages built"},{"section":"Review","title":"Mobile check"},{"section":"Review","title":"Speed check (PageSpeed)"},{"section":"Review","title":"Forms and tracking tested with a test enquiry"},{"section":"Launch","title":"Launch"},{"section":"Local SEO","title":"Google Business Profile set up"},{"section":"Local SEO","title":"Search Console and sitemap"},{"section":"Local SEO","title":"Local SEO month 1"},{"section":"Local SEO","title":"Local SEO month 2"},{"section":"Local SEO","title":"Local SEO month 3"},{"section":"Follow-up","title":"Review request"},{"section":"Follow-up","title":"Ask permission to feature"}],
    "premium":[{"section":"Kickoff","title":"Kickoff call"},{"section":"Content","title":"Photo shoot"},{"section":"Content","title":"Copywriting"},{"section":"Content","title":"Logo, photos and copy received"},{"section":"Content","title":"Domain and DNS access"},{"section":"Design","title":"Homepage design approved"},{"section":"Build","title":"Pages built"},{"section":"Review","title":"Mobile check"},{"section":"Review","title":"Speed check (PageSpeed)"},{"section":"Review","title":"Forms and tracking tested with a test enquiry"},{"section":"Launch","title":"Launch"},{"section":"Local SEO","title":"Google Business Profile set up"},{"section":"Local SEO","title":"Search Console and sitemap"},{"section":"Local SEO","title":"Local SEO month 1"},{"section":"Local SEO","title":"Local SEO month 2"},{"section":"Local SEO","title":"Local SEO month 3"},{"section":"Follow-up","title":"Review request"},{"section":"Follow-up","title":"Ask permission to feature"}],
    "local_seo":[{"section":"Kickoff","title":"Kickoff call"},{"section":"Access","title":"Google Business Profile access"},{"section":"Access","title":"Search Console access"},{"section":"Local SEO","title":"Business details and service areas confirmed"},{"section":"Local SEO","title":"Local SEO month 1"},{"section":"Local SEO","title":"Local SEO month 2"},{"section":"Local SEO","title":"Local SEO month 3"},{"section":"Review","title":"Review progress with client"}]
  }
}$config$::jsonb);

insert into public.products(name,kind,price,summary,included,sort) values
  ('Website','once',2200,'A website for a local business. Confirm the scope, price and timing before quoting.',array['Homepage design','Mobile-friendly build','Google Business Profile setup','First 3 months of local SEO'],10),
  ('Premium website','once',4500,'From $4,500. Set the fixed project price after the brief.',array['Homepage design','Mobile-friendly build','Photo shoot coordination','Copywriting','Google Business Profile setup','First 3 months of local SEO'],20),
  ('Hosting and maintenance','monthly',49,'Ongoing hosting and maintenance.',array['Website hosting','Maintenance'],30);

insert into public.templates(channel,name,body) values
  ('sms','First text · tradie demo request','Hi {first_name}, it''s Troy from Lumen. Thanks for requesting a homepage demo for {business}. Before I build it, what would you most like the new website to do, and who else needs to be involved in the decision? We''ll confirm the scope, price and timing together first.'),
  ('sms','First text · promised date','Hi {first_name}, it''s Troy from Lumen. Got your request for {business}. I''ll text your demo and a fixed quote {promise}. If you have your logo and a few photos of your work, send them through and I''ll use them.'),
  ('sms','First text · general enquiry','Hi {first_name}, it''s Troy from Lumen. Thanks for getting in touch about {business}. When''s a good time for a quick call?'),
  ('sms','Missed call','Hi {first_name}, Troy from Lumen here. I just tried to call about your enquiry. When suits you for a quick chat?'),
  ('sms','Call confirmed','Thanks {first_name}. I''ll call you on this number at {call_time}. Talk then. Troy, Lumen adl'),
  ('sms','Demo ready','Hi {first_name}, your homepage demo is ready: {demo_link}. Have a look on your phone and tell me what you think. Happy to run through it on a quick call.'),
  ('sms','Quote sent','Hi {first_name}, here''s your fixed quote for the {business} website: {quote_link}. Any questions, just reply here.'),
  ('sms','Quote follow-up','Hi {first_name}, just checking the quote came through OK. Happy to answer anything.'),
  ('sms','Invoice reminder','Hi {first_name}, a quick reminder that invoice {invoice_number} for {amount} was due on {due_date}. Let me know if anything''s unclear. Thanks, Troy');

insert into public.automations(key,enabled,config) values
  ('new_lead',true,'{}'),('promise_date',true,'{"due_time":"15:00"}'),
  ('no_answer',true,'{"attempts":3,"working_days":5}'),('call_booked',true,'{"remind_minutes":15}'),
  ('demo_sent',true,'{"working_days":2}'),('quote_sent',true,'{"working_days":[2,7]}'),
  ('quote_accepted',true,'{}'),('project_launched',true,'{}'),('invoice_overdue',true,'{}'),
  ('billing_day',true,'{}'),('lost_check_in',false,'{"days":90}'),('stop_received',true,'{}');
