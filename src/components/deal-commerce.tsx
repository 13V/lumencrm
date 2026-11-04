'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {ArrowUpRight,ExternalLink} from 'lucide-react';
import {Button} from './ui';
import type {CrmData,CrmMode,Role} from '@/lib/types';
import type {CommerceData} from '@/lib/commerce-types';
import {mergeRelatedCrm,type RelatedCrm} from '@/lib/merge-related';
import {createDemoCommerceData} from '@/lib/demo-commerce';
import {formatMoney} from '@/lib/domain';
export function DealCommerce({dealId,mode,role,data}:{dealId:string;mode:CrmMode;role:Role;data:CrmData}){
  const [commerce,setCommerce]=useState<CommerceData|null>(null),[error,setError]=useState('');
  useEffect(()=>{if(mode==='demo'){try{setCommerce(JSON.parse(localStorage.getItem('lumen-commerce-demo-v1')||'null')||createDemoCommerceData(data));}catch{setCommerce(createDemoCommerceData(data));}return;}const controller=new AbortController();void fetch(`/api/commerce?deal_id=${encodeURIComponent(dealId)}`,{signal:controller.signal}).then(async r=>{const result=await r.json();if(!r.ok)throw new Error(result.error||'Related records could not be loaded.');setCommerce(result.data);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>controller.abort();},[dealId,mode]);
  const records=mergeRelatedCrm(data,(commerce as (CommerceData&{related?:RelatedCrm})|null)?.related);
  const business=records.businesses.find(b=>b.id===records.deals.find(d=>d.id===dealId)?.business_id);
  const demos=commerce?.demos.filter(d=>d.deal_id===dealId)??[],quotes=commerce?.quotes.filter(q=>q.deal_id===dealId)??[];
  return <div className="deal-commerce" aria-label={`Delivery and quotes for ${business?.name??'this lead'}`}><section className="detail-section"><div className="section-title"><h3>Demos</h3><Link href={`/demos?deal=${dealId}`} className="section-link">Manage <ArrowUpRight size={13}/></Link></div>{demos.map(d=><div className="related-record" key={d.id}><div><strong>{d.status.replaceAll('_',' ')}</strong><small>{d.build_minutes} build minutes{d.sent_at?` · sent ${new Date(d.sent_at).toLocaleDateString('en-AU')}`:''}</small></div>{d.url&&<Button asChild variant="ghost" size="icon"><a href={d.url} target="_blank" rel="noreferrer" aria-label="Open demo preview"><ExternalLink size={14}/></a></Button>}</div>)}{commerce&&!demos.length&&<p className="text-small muted">No demo linked yet.</p>}</section>{role!=='staff'&&<section className="detail-section"><div className="section-title"><h3>Quotes</h3><Link href={`/quotes?deal=${dealId}`} className="section-link">Manage <ArrowUpRight size={13}/></Link></div>{quotes.map(q=><Link href={`/quotes?quote=${q.id}`} className="related-record" key={q.id}><div><strong>{q.number} · {q.status}</strong><small>{formatMoney(q.total_once)} + {formatMoney(q.total_monthly)}/mo</small></div><ArrowUpRight size={14}/></Link>)}{commerce&&!quotes.length&&<p className="text-small muted">No quote linked yet.</p>}</section>}{error&&<p className="error-text">{error}</p>}</div>;
}
