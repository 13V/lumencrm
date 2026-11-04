'use client';

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, Loader2, Send, ShieldCheck } from 'lucide-react';
import { Button, Field, Sheet } from './ui';
import {useOnline} from './use-online';
import { canMessage, fillTemplate, smsSegments } from '@/lib/domain';
import type { CrmData, CrmMode, Deal } from '@/lib/types';

type Template={id:string;name:string;body:string;subject?:string|null;channel:string};
type MessageSettings={templates:Template[];configured:boolean;consent:{allowed:boolean;reason:string|null};takeover_configured?:boolean};
type Props={open:boolean;onClose:()=>void;deal:Deal|undefined;data:CrmData;mode:CrmMode;channel:'sms'|'email';onSent:(message:string)=>void;initialBody?:string};
const DEMO_TEMPLATES:Template[]=[
  {id:'first-reply',name:'First reply',channel:'sms',body:'Hi {first_name}, thanks for getting in touch. It is Troy from Lumen adl. When would be a good time for a quick call about {business}?'},
  {id:'call-followup',name:'After our call',channel:'sms',body:'Hi {first_name}, thanks for your time today. I will put together the next steps for {business} and send them through shortly. Troy, Lumen adl.'},
  {id:'email-intro',name:'A quick introduction',channel:'email',subject:'A website for {business}',body:'Hi {first_name},\n\nThanks for getting in touch. I would love to learn a little more about {business} and what you need from your website.\n\nWhen would suit you for a quick conversation?\n\nTroy\nLumen adl'},
];

export function MessageSheet({open,onClose,deal,data,mode,channel,onSent,initialBody=''}:Props) {
  const [settings,setSettings]=useState<MessageSettings|null>(null),[body,setBody]=useState(''),[subject,setSubject]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[confirmLong,setConfirmLong]=useState(false);
  const [variableValues,setVariableValues]=useState<Record<string,string>>({});
  const online=useOnline();
  const requestId=useRef<string>('');
  const contact=data.contacts.find(c=>c.id===deal?.contact_id),business=data.businesses.find(b=>b.id===deal?.business_id);
  useEffect(()=>{
    if(!open||!deal)return;
    setBody(initialBody);setSubject('');setError('');setConfirmLong(false);setVariableValues({});requestId.current=crypto.randomUUID();
    if(mode==='demo'){setSettings({templates:DEMO_TEMPLATES.filter(t=>t.channel===channel),configured:false,consent:{allowed:!!contact&&canMessage(contact,channel),reason:contact&&!canMessage(contact,channel)?'This contact has opted out or is marked do not contact.':null}});return;}
    const controller=new AbortController();setSettings(null);
    void fetch(`/api/messages?deal_id=${encodeURIComponent(deal.id)}&channel=${channel}`,{signal:controller.signal}).then(async r=>{const result=await r.json();if(!r.ok)throw new Error(result.error||'Messaging settings could not be loaded.');setSettings(result);}).catch(e=>{if(e.name!=='AbortError')setError(e.message);});
    return()=>controller.abort();
  },[open,deal?.id,channel,mode,initialBody]);
  const variables=[...new Set([...`${body}\n${subject}`.matchAll(/\{([a-z_]+)\}/g)].map(match=>match[1]))];
  const unresolved=variables.some(key=>!variableValues[key]?.trim());
  const filledBody=fillTemplate(body,variableValues),filledSubject=fillTemplate(subject,variableValues);
  const footer=`${/\blumen\b/i.test(filledBody)?'':'\n\nTroy at Lumen adl.'}${channel==='sms'?/reply\s+stop/i.test(filledBody)?'':'\nReply STOP to opt out.':/unsubscribe/i.test(filledBody)?'':'\n\nTo stop receiving emails, reply unsubscribe.'}`;
  const message=filledBody.trim()?filledBody.trim()+footer:'';
  const segments=smsSegments(message);
  const allowed=(mode==='demo'||online)&&!!settings?.consent.allowed&&!!contact&&canMessage(contact,channel);
  const destination=channel==='sms'?contact?.phone_e164:contact?.email;
  const applyTemplate=(id:string)=>{const t=settings?.templates.find(t=>t.id===id);if(!t)return;const variables={first_name:contact?.first_name??'',last_name:contact?.last_name??'',name:`${contact?.first_name??''} ${contact?.last_name??''}`.trim(),business:business?.name??'',business_name:business?.name??'',trade:business?.trade??'',suburb:business?.suburb??'',sender_name:'Troy',studio_name:'Lumen adl'};setBody(fillTemplate(t.body,variables));setSubject(fillTemplate(t.subject??'',variables));setConfirmLong(false);requestId.current=crypto.randomUUID();};
  async function send(){
    if(!deal||!allowed||!settings?.configured||mode==='demo'||unresolved)return;
    setBusy(true);setError('');
    try{const response=await fetch('/api/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({deal_id:deal.id,request_id:requestId.current,channel,body:message,...(channel==='email'?{subject:filledSubject}:{}),...(confirmLong?{confirm_long_sms:true}:{})})});const result=await response.json();if(!response.ok)throw new Error(result.error||'The message could not be queued.');onSent(result.duplicate?'This send was already requested. Check the timeline.':result.warning||'Message queued for sending');onClose();}catch(e){setError(e instanceof Error?e.message:'The message could not be queued.');}finally{setBusy(false);}
  }
  const fallback=channel==='sms'?`sms:${destination??''}?body=${encodeURIComponent(message)}`:`mailto:${destination??''}?subject=${encodeURIComponent(filledSubject)}&body=${encodeURIComponent(message)}`;
  return <Sheet open={open} onOpenChange={v=>!v&&onClose()} title={channel==='sms'?'Send a text':'Send an email'} description={`${contact?.first_name??'Contact'}${contact?.last_name?` ${contact.last_name}`:''} · ${destination??'No address on file'}`}>
    <div className="form-stack">
      {!settings&&!error&&<p className="muted" role="status">Loading messaging options…</p>}
      {settings&&!allowed&&<div className="optout-banner"><ShieldCheck size={16}/>{settings.consent.reason||'This contact cannot receive messages through this channel.'}</div>}
      {settings&&<Field label="Template"><select aria-label="Message template" defaultValue="" onChange={e=>applyTemplate(e.target.value)} disabled={!allowed}><option value="">Write your own message</option>{settings.templates.filter(t=>t.channel===channel).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>}
      {channel==='email'&&<Field label="Subject"><input value={subject} onChange={e=>{setSubject(e.target.value);requestId.current=crypto.randomUUID();}} disabled={!allowed}/></Field>}
      <Field label="Message"><textarea className="message-composer" rows={7} value={body} onChange={e=>{setBody(e.target.value);setConfirmLong(false);requestId.current=crypto.randomUUID();}} placeholder={channel==='sms'?'A short, useful message…':'Write your email…'} disabled={!allowed}/></Field>
      {variables.length>0&&<div className="form-stack message-variable-fields"><h3>Fill in the message details</h3>{variables.map(key=><Field key={key} label={key.replaceAll('_',' ')}><input value={variableValues[key]??''} onChange={e=>{setVariableValues(v=>({...v,[key]:e.target.value}));requestId.current=crypto.randomUUID();setConfirmLong(false);}} required disabled={!allowed}/></Field>)}</div>}
      {message&&<div className="message-preview"><p className="eyebrow">Recipient preview</p><p>{message}</p></div>}
      {channel==='sms'&&<div className="message-count"><span>{segments.units} characters · {segments.segments} {segments.segments===1?'segment':'segments'}</span><span>{segments.encoding}</span></div>}
      {channel==='sms'&&segments.warning&&<label className="check-field"><input type="checkbox" checked={confirmLong} onChange={e=>setConfirmLong(e.target.checked)}/><span>This message uses {segments.segments} SMS segments. Send it as written.</span></label>}
      {mode==='demo'&&<p className="message-notice">Demo preview. No messages are sent.</p>}
      {settings&&!settings.configured&&mode==='live'&&<p className="message-notice">Sending is not connected. Open a draft in your device’s app; messages sent there are not tracked in Lumen.</p>}
      {error&&<p className="error-text" role="alert">{error}</p>}
      <div className="form-footer"><Button variant="outline" onClick={onClose}>Cancel</Button>{settings?.configured||mode==='demo'?<Button disabled={busy||unresolved||!allowed||!message||!destination||channel==='email'&&!subject.trim()||segments.warning&&channel==='sms'&&!confirmLong||mode==='demo'} onClick={()=>void send()}>{busy?<Loader2 size={15} className="spin"/>:<Send size={15}/>}Send {channel==='sms'?'text':'email'}</Button>:<Button asChild={allowed&&!unresolved&&!!message&&!!destination} disabled={unresolved||!allowed||!message||!destination}>{allowed&&!unresolved&&message&&destination?<a href={fallback}><ExternalLink size={15}/>Open {channel==='sms'?'Messages':'Mail'}</a>:<><ExternalLink size={15}/>Open {channel==='sms'?'Messages':'Mail'}</>}</Button>}</div>
    </div>
  </Sheet>;
}
