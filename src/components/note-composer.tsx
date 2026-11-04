'use client';
import {useEffect,useState} from 'react';
import {ArrowUpRight,Loader2} from 'lucide-react';
import {Button} from './ui';
export function NoteComposer({dealId,disabled,busy,onSave}:{dealId:string;disabled:boolean;busy:boolean;onSave:(body:string)=>Promise<boolean|undefined>}){
  const key=`lumen-note-draft-${dealId}`;const [body,setBody]=useState('');
  useEffect(()=>{try{setBody(localStorage.getItem(key)||'');}catch{setBody('');}},[key]);
  return <div><form className="note-composer" onSubmit={e=>{e.preventDefault();if(!body.trim())return;void onSave(body.trim()).then(ok=>{if(ok){setBody('');try{localStorage.removeItem(key);}catch{}}});}}><textarea aria-label="Add a note" placeholder="Leave a note for your future self…" value={body} onChange={e=>{setBody(e.target.value);try{localStorage.setItem(key,e.target.value);}catch{}}} disabled={disabled} required/><Button type="submit" size="icon" aria-label="Save note" disabled={disabled||busy||!body.trim()}>{busy?<Loader2 size={17} className="spin"/>:<ArrowUpRight size={18}/>}</Button></form>{body&&<p className="draft-status">Draft saved on this device · ⌘/Ctrl + Enter to save note</p>}</div>;
}
