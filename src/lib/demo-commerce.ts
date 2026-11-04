import {EMPTY_COMMERCE,type CommerceData} from './commerce-types';
import type {CrmData} from './types';

export function createDemoCommerceData(_crmData?:CrmData):CommerceData{
  const today=new Date(),day=(offset:number)=>new Date(today.getTime()+offset*86400000).toISOString().slice(0,10);
  const data:CommerceData=structuredClone(EMPTY_COMMERCE);
  data.products=[
    {id:'product-website',name:'Website',kind:'once',price:2200,summary:'A clear, useful website for a local business.',included:['Homepage design','Mobile-friendly build','Google Business Profile setup','First 3 months of local SEO'],active:true},
    {id:'product-premium',name:'Premium website',kind:'once',price:4500,summary:'A tailored website with copywriting and photo shoot coordination.',included:['Homepage design','Mobile-friendly build','Photo shoot coordination','Copywriting','Google Business Profile setup','First 3 months of local SEO'],active:true},
    {id:'product-hosting',name:'Hosting and maintenance',kind:'monthly',price:49,summary:'Ongoing hosting and maintenance.',included:['Website hosting','Maintenance'],active:true},
  ];
  data.demos=[
    {id:'demo-build-1',deal_id:'demo-07',status:'building',url:null,sent_at:null,build_minutes:45,notes:'A simple homepage focused on quality workmanship and recent roofing projects.'},
    {id:'demo-build-2',deal_id:'demo-15',status:'sent',url:'https://example.com/ward-garden-preview',sent_at:day(-1)+'T04:00:00Z',build_minutes:70,notes:'Garden photography and a clear local service area.'},
    {id:'demo-build-3',deal_id:'demo-25',status:'to_build',url:null,sent_at:null,build_minutes:0,notes:'Confirm the project gallery before starting.'},
  ];
  data.quotes=[
    {id:'quote-1',deal_id:'demo-08',number:'QUO-0001',status:'sent',public_token:'fictional-preview-quote-1',issued_at:day(-3)+'T02:00:00Z',expires_at:day(27)+'T12:00:00Z',total_once:2200,total_monthly:49,terms_url:'https://example.com/terms',notes:'A focused website for a local property care business.',view_count:2,accepted_at:null},
    {id:'quote-2',deal_id:'demo-11',number:'QUO-0002',status:'draft',public_token:'fictional-preview-quote-2',issued_at:null,expires_at:day(30)+'T12:00:00Z',total_once:4500,total_monthly:49,terms_url:'https://example.com/terms',notes:'Premium website, including copywriting and photography coordination.',view_count:0,accepted_at:null},
    {id:'quote-3',deal_id:'demo-16',number:'QUO-0003',status:'accepted',public_token:'fictional-preview-quote-3',issued_at:day(-15)+'T02:00:00Z',expires_at:day(15)+'T12:00:00Z',total_once:2200,total_monthly:49,terms_url:'https://example.com/terms',notes:null,view_count:3,accepted_at:day(-12)+'T02:00:00Z'},
  ];
  data.quotes.forEach((q,i)=>data.quote_items.push({id:`line-${q.id}-1`,quote_id:q.id,product_id:i===1?'product-premium':'product-website',description:i===1?'Premium website':'Website',qty:1,unit_price:q.total_once,kind:'once',included:false,sort:0},{id:`line-${q.id}-2`,quote_id:q.id,product_id:'product-hosting',description:'Hosting and maintenance',qty:1,unit_price:49,kind:'monthly',included:false,sort:1}));
  data.projects=[
    {id:'project-1',deal_id:'demo-16',business_id:'business-demo-16',name:'Lane Concreting website',stage_key:'build',template_key:'website',kickoff_at:day(-10)+'T02:00:00Z',launched_at:null,site_url:null,feature_permission:'unknown',feature_permission_at:null,feature_permission_note:null},
    {id:'project-2',deal_id:'demo-18',business_id:'business-demo-18',name:'Hart Solar website',stage_key:'local_seo',template_key:'website',kickoff_at:day(-40)+'T02:00:00Z',launched_at:day(-7)+'T02:00:00Z',site_url:'https://example.com/hart-solar',feature_permission:'asked',feature_permission_at:day(-7)+'T02:00:00Z',feature_permission_note:'Permission requested at handover.'},
  ];
  const checklist=[['Kickoff','Kickoff call'],['Content','Logo, photos and copy received'],['Content','Domain and DNS access'],['Design','Homepage design approved'],['Build','Pages built'],['Review','Mobile check'],['Review','Speed check'],['Review','Forms and tracking tested'],['Launch','Launch'],['Local SEO','Google Business Profile set up'],['Local SEO','Search Console and sitemap'],['Local SEO','Local SEO month 1'],['Local SEO','Local SEO month 2'],['Local SEO','Local SEO month 3'],['Follow-up','Review request'],['Follow-up','Ask permission to feature']];
  data.projects.forEach((p,pi)=>checklist.forEach(([section,title],i)=>data.checklist_items.push({id:`check-${p.id}-${i}`,project_id:p.id,section,title,due_at:i>=11?day((i-10)*30)+'T02:00:00Z':null,done_at:i<(pi===0?4:11)?day(-5)+'T02:00:00Z':null,sort:i})));
  data.subscriptions=[{id:'sub-1',business_id:'business-demo-18',product_id:'product-hosting',price:49,status:'active',started_on:day(-7),billing_day:today.getDate(),next_invoice_on:day(23),cancelled_on:null},{id:'sub-2',business_id:'business-demo-23',product_id:'product-hosting',price:49,status:'active',started_on:day(-45),billing_day:15,next_invoice_on:day(10),cancelled_on:null}];
  data.invoices=[
    {id:'invoice-1',number:'LUM-0001',status:'paid',business_id:'business-demo-16',contact_id:'contact-demo-16',deal_id:'demo-16',project_id:'project-1',subscription_id:null,issued_on:day(-12),due_on:day(2),subtotal:1100,gst:0,total:1100,notes:'Website deposit · QUO-0003',gst_wording:'No GST was charged.'},
    {id:'invoice-2',number:'LUM-0002',status:'part_paid',business_id:'business-demo-18',contact_id:'contact-demo-18',deal_id:'demo-18',project_id:'project-2',subscription_id:null,issued_on:day(-21),due_on:day(-7),subtotal:2200,gst:0,total:2200,notes:'Website build',gst_wording:'No GST was charged.'},
    {id:'invoice-3',number:'LUM-0003',status:'sent',business_id:'business-demo-23',contact_id:'contact-demo-23',deal_id:'demo-23',project_id:null,subscription_id:'sub-2',issued_on:day(-2),due_on:day(12),subtotal:49,gst:0,total:49,notes:'Monthly hosting and maintenance',gst_wording:'No GST was charged.'},
  ];
  data.invoices.forEach(i=>data.invoice_items.push({id:`line-${i.id}`,invoice_id:i.id,product_id:null,description:i.notes??'Website services',qty:1,unit_price:i.total,included:false,sort:0}));
  data.payments=[{id:'payment-1',invoice_id:'invoice-1',amount:1100,received_on:day(-10),method:'bank_transfer',reference:'Demo deposit'},{id:'payment-2',invoice_id:'invoice-2',amount:1100,received_on:day(-14),method:'bank_transfer',reference:'Demo part payment'}];
  return data;
}
