'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {ArrowUpRight,Clock3,Wallet} from 'lucide-react';
import type {CrmData,CrmMode} from '@/lib/types';
import type {CommerceData} from '@/lib/commerce-types';
import {mergeRelatedCrm,type RelatedCrm} from '@/lib/merge-related';
import {createDemoCommerceData} from '@/lib/demo-commerce';
import {formatMoney,invoiceBalance} from '@/lib/domain';
import {formatInTimeZone} from 'date-fns-tz';
export function TodayMoney({mode,crmData}:{mode:CrmMode;crmData:CrmData}){
  const [data,setData]=useState<CommerceData|null>(null),[error,setError]=useState('');
  useEffect(()=>{if(mode==='demo'){try{const saved=localStorage.getItem('lumen-commerce-demo-v1');setData(saved?JSON.parse(saved):createDemoCommerceData(crmData));}catch{setData(createDemoCommerceData(crmData));}return;}const c=new AbortController();void fetch('/api/commerce',{signal:c.signal}).then(async r=>{const result=await r.json();if(!r.ok)throw new Error(result.error||'Money overview could not be loaded.');setData(result.data);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>c.abort();},[mode]);
  const records=mergeRelatedCrm(crmData,(data as (CommerceData&{related?:RelatedCrm})|null)?.related);
  const today=formatInTimeZone(new Date(),'Australia/Adelaide','yyyy-MM-dd');
  const overdue=data?.invoices.filter(i=>i.due_on<today&&invoiceBalance(i.total,data.payments.filter(p=>p.invoice_id===i.id))>0&&!['void','draft'].includes(i.status))??[];
  const viewed=data?.quotes.filter(q=>q.view_count>0&&['sent','viewed'].includes(q.status)&&!records.activities.some(a=>a.deal_id===q.deal_id&&['sms_in','email_in','chloe_in'].includes(a.type)&&q.issued_at&&a.occurred_at>q.issued_at))??[];
  const outstanding=data?.invoices.filter(i=>!['void','draft'].includes(i.status)).reduce((s,i)=>s+Math.max(0,invoiceBalance(i.total,data.payments.filter(p=>p.invoice_id===i.id))),0)??0;
  const monthly=data?.subscriptions.filter(s=>s.status==='active').reduce((sum,s)=>sum+s.price,0)??0;
  return <section className="today-section today-money"><div className="section-title"><h2><span className="section-icon" aria-hidden="true"><Wallet size={16}/></span>Money, at a glance</h2><span className="section-caption">AUD</span></div><div className="card"><div className="money-summary"><div><p className="label">Outstanding invoices</p><p className="value">{data?outstanding?formatMoney(outstanding):'None due':'—'}</p></div><div><p className="label">Active monthly</p><p className="value">{data?monthly?formatMoney(monthly):'None yet':'—'}{monthly>0&&<small>/mo</small>}</p></div></div>{error&&<p className="error-text">{error}</p>}<div className="money-followups"><h3>Overdue invoices <span className="count">{overdue.length}</span></h3>{overdue.map(i=><Link href="/invoices" key={i.id}><span><strong>{records.businesses.find(b=>b.id===i.business_id)?.name??i.number}</strong><small>{i.number} · due {new Intl.DateTimeFormat('en-AU',{day:'numeric',month:'short'}).format(new Date(i.due_on))}</small></span><span className="amber-text">{formatMoney(invoiceBalance(i.total,data!.payments.filter(p=>p.invoice_id===i.id)))}</span><ArrowUpRight size={13}/></Link>)}{data&&!overdue.length&&<p className="muted">No overdue invoices.</p>}</div><div className="money-followups"><h3>Viewed quotes <span className="count">{viewed.length}</span></h3>{viewed.map(q=><Link href="/quotes" key={q.id}><span><strong>{records.businesses.find(b=>b.id===records.deals.find(d=>d.id===q.deal_id)?.business_id)?.name??q.number}</strong><small>{q.number} · {q.view_count} {q.view_count===1?'view':'views'} · no reply recorded</small></span><ArrowUpRight size={13}/></Link>)}{data&&!viewed.length&&<p className="muted">No viewed quotes waiting for a reply.</p>}</div></div></section>;
}
