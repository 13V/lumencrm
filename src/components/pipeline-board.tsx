'use client';

import { useState } from 'react';
import Link from 'next/link';
import { DndContext, PointerSensor, pointerWithin, useSensor, useSensors, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/core';
import { CircleDot, GripVertical } from 'lucide-react';
import type { CrmData, Deal } from '@/lib/types';
import { STAGES } from '@/lib/types';

type Props = { data: CrmData; demo: boolean; disabled: boolean; onMove: (id: string, stage: string) => void };
const money = (n: number) => new Intl.NumberFormat('en-AU',{style:'currency',currency:'AUD',maximumFractionDigits:0}).format(n);

function DealCard({deal,data,demo,disabled,onMove,stages}:Props&{deal:Deal;stages:{key:string;label:string}[]}) {
  const {attributes,listeners,setNodeRef,transform,isDragging}=useDraggable({id:deal.id,disabled});
  const contact=data.contacts.find(c=>c.id===deal.contact_id),business=data.businesses.find(b=>b.id===deal.business_id);
  const name=contact?`${contact.first_name} ${contact.last_name??''}`.trim():deal.title;
  return <article ref={setNodeRef} style={transform?{transform:`translate3d(${transform.x}px,${transform.y}px,0)`,zIndex:100}:undefined} className={`kanban-card ${isDragging?'is-dragging':''}`}>
    <div className="kanban-card-title"><h3><Link className="kanban-name" href={`/leads/${deal.id}${demo?'?demo=1':''}`}>{name}</Link></h3><button className="drag-handle" aria-label={`Drag ${name} to another stage`} {...attributes} {...listeners} disabled={disabled}><GripVertical size={16}/></button></div>
    <p>{business?.name}</p>{!deal.next_step&&<div className="next-warning"><CircleDot size={11}/>No next step</div>}
    <footer><span className={deal.value_once?undefined:'no-value'}>{deal.value_once?money(deal.value_once):'Value not set'}</span><select aria-label={`Stage for ${name}`} data-stage={deal.stage_key} value={deal.stage_key} disabled={disabled} onChange={e=>onMove(deal.id,e.target.value)}>{stages.map(s=><option key={s.key} value={s.key}>{s.label}</option>)}</select></footer>
  </article>;
}

function Column({stage,children,count}: {stage:{key:string;label:string};children:React.ReactNode;count:number}) {
  const {setNodeRef,isOver}=useDroppable({id:stage.key});
  return <section ref={setNodeRef} className={`kanban-column ${isOver?'drop-target':''}`} data-stage={stage.key} aria-label={`${stage.label} stage`}><div className="kanban-column-header"><span className={`dot ${stage.key==='won'?'won-dot':''}`}/>{stage.label}<span className="count">{count}</span></div>{children}{!count&&<div className="kanban-empty">No deals here yet</div>}</section>;
}

export function PipelineBoard(props:Props) {
  const sensors=useSensors(useSensor(PointerSensor,{activationConstraint:{distance:7}}));
  const [announcement,setAnnouncement]=useState('');
  const stages=props.data.config?.sales_stages?.length?props.data.config.sales_stages:STAGES;
  function onDragEnd({active,over}:DragEndEvent) {
    if(!over||props.disabled)return;
    const deal=props.data.deals.find(d=>d.id===active.id),stage=stages.find(s=>s.key===over.id);
    if(deal&&stage&&deal.stage_key!==stage.key){props.onMove(deal.id,stage.key);setAnnouncement(`Moved to ${stage.label}.`);}
  }
  return <><p className="board-hint">Drag a card by its handle, or use its stage menu.</p><span className="sr-only" aria-live="polite">{announcement}</span><DndContext id="pipeline-board" sensors={sensors} collisionDetection={pointerWithin} onDragEnd={onDragEnd}><div className="kanban">{stages.map(stage=>{const deals=props.data.deals.filter(d=>d.stage_key===stage.key&&(d.outcome==='open'||stage.key==='won'&&d.outcome==='won'));return <Column stage={stage} key={stage.key} count={deals.length}>{deals.map(deal=><DealCard key={deal.id} {...props} deal={deal} stages={stages}/>)}</Column>;})}</div></DndContext></>;
}
