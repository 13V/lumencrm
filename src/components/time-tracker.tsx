'use client';
import {useEffect,useState} from 'react';
import {Clock3,Pause,Play} from 'lucide-react';
import {Button} from './ui';
type Props={dealId:string;minutes:number;kind:'presales_minutes'|'demo_build_minutes';disabled:boolean;onSave:(patch:Record<string,unknown>&{action:string},message:string,close?:boolean)=>Promise<boolean|undefined>};
export function TimeTracker({dealId,minutes,kind,disabled,onSave}:Props){
  const key=`lumen-timer-${dealId}-${kind}`;const [started,setStarted]=useState<number|null>(null),[elapsed,setElapsed]=useState(0),[editing,setEditing]=useState(false),[draft,setDraft]=useState(minutes),[busy,setBusy]=useState(false);
  useEffect(()=>{try{const saved=Number(localStorage.getItem(key));if(saved>0){setStarted(saved);setElapsed(Math.max(0,Date.now()-saved));}else{setStarted(null);setElapsed(0);}}catch{}},[key]);
  useEffect(()=>{if(!started)return;const timer=setInterval(()=>setElapsed(Math.max(0,Date.now()-started)),1000);return()=>clearInterval(timer);},[started]);
  async function save(value:number){setBusy(true);const ok=await onSave({action:'update_deal',id:dealId,[kind]:value},'Time saved',false);setBusy(false);return ok;}
  async function stop(){if(!started)return;const ok=await save(minutes+Math.ceil((Date.now()-started)/60000));if(ok){setStarted(null);setElapsed(0);try{localStorage.removeItem(key);}catch{}}}
  return <div className="time-tracker"><div><span className="time-label"><Clock3 size={13}/>{kind==='presales_minutes'?'Pre-sales':'Demo build'}</span>{editing?<form className="time-edit" onSubmit={e=>{e.preventDefault();void save(draft).then(ok=>{if(ok)setEditing(false);});}}><input aria-label={`${kind==='presales_minutes'?'Pre-sales':'Demo build'} minutes`} type="number" min="0" step="1" value={draft} onChange={e=>setDraft(Number(e.target.value))}/><Button size="small" disabled={busy}>Save</Button></form>:<button className="time-total plain-button" disabled={disabled||!!started} onClick={()=>{setDraft(minutes);setEditing(true);}}>{minutes} min{!disabled&&!started&&<small>Edit</small>}</button>}</div><div className="time-controls">{started&&<span className="timer-running" aria-live="off">{Math.floor(elapsed/60000)}:{String(Math.floor(elapsed/1000)%60).padStart(2,'0')}</span>}<Button variant="outline" size="small" disabled={disabled||busy||editing} onClick={()=>{if(started)void stop();else{const value=Date.now();setStarted(value);try{localStorage.setItem(key,String(value));}catch{}}}}>{started?<><Pause size={13}/>Stop & save</>:<><Play size={13}/>Start</>}</Button></div></div>;
}
