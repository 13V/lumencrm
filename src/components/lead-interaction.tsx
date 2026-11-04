'use client';
import {cloneElement,useEffect,useRef,type HTMLAttributes,type ReactElement} from 'react';
type Props={id:string;name:string;enabled:boolean;selected:boolean;selecting:boolean;onSelect:()=>void;onCall:()=>void;onSnooze:()=>void;children:ReactElement<HTMLAttributes<HTMLElement>>};
export function LeadInteraction({name,enabled,selected,selecting,onSelect,onCall,onSnooze,children}:Props){
  const touch=useRef<{x:number;y:number;held:boolean;timer:ReturnType<typeof setTimeout>|null}|null>(null),suppress=useRef(false);
  useEffect(()=>()=>{if(touch.current?.timer)clearTimeout(touch.current.timer);},[]);
  return cloneElement(children,{
    className:`${children.props.className??''} gesture-lead ${selecting?'is-selecting':''} ${selected?'is-selected':''}`,
    onTouchStart:e=>{if(!enabled||e.touches.length!==1||(e.target as HTMLElement).closest('button,input,select,textarea,.lead-actions'))return;const t=e.touches[0];touch.current={x:t.clientX,y:t.clientY,held:false,timer:setTimeout(()=>{if(touch.current){touch.current.held=true;suppress.current=true;onSelect();}},500)};},
    onTouchMove:e=>{if(!touch.current)return;const t=e.touches[0];if(Math.abs(t.clientX-touch.current.x)>10||Math.abs(t.clientY-touch.current.y)>10){if(touch.current.timer)clearTimeout(touch.current.timer);touch.current.timer=null;}},
    onTouchEnd:e=>{const start=touch.current;if(!start)return;if(start.timer)clearTimeout(start.timer);touch.current=null;if(start.held){e.preventDefault();setTimeout(()=>{suppress.current=false;},400);return;}if(selecting)return;const t=e.changedTouches[0],dx=t.clientX-start.x,dy=t.clientY-start.y;if(Math.abs(dx)>=75&&Math.abs(dy)<40){e.preventDefault();suppress.current=true;setTimeout(()=>{suppress.current=false;},400);if(dx>0)onCall();else onSnooze();}},
    onTouchCancel:()=>{if(touch.current?.timer)clearTimeout(touch.current.timer);touch.current=null;},
    onContextMenu:e=>{if(touch.current?.held||selecting)e.preventDefault();},
    onClickCapture:e=>{if(suppress.current){suppress.current=false;e.preventDefault();e.stopPropagation();return;}if(selecting&&!(e.target as HTMLElement).closest('input,button,select')){e.preventDefault();e.stopPropagation();onSelect();}},
    children:<>{selecting&&<label className="lead-selection"><input type="checkbox" aria-label={`Select ${name}`} checked={selected} onChange={onSelect}/></label>}{children.props.children}</>,
  });
}
