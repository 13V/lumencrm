import type {CrmData} from './types';
export type RelatedCrm=Partial<Pick<CrmData,'deals'|'contacts'|'businesses'|'activities'>>;
export function mergeRelatedCrm(base:CrmData,related?:RelatedCrm):CrmData{
  if(!related)return base;
  const merge=<T extends {id:string}>(current:T[],incoming:T[]|undefined)=>{const rows=new Map(current.map(row=>[row.id,row]));for(const row of incoming??[])rows.set(row.id,{...rows.get(row.id),...row});return [...rows.values()];};
  return {...base,deals:merge(base.deals,related.deals),contacts:merge(base.contacts,related.contacts),businesses:merge(base.businesses,related.businesses),activities:merge(base.activities,related.activities).map(row=>({...row,body:row.body??base.activities.find(old=>old.id===row.id)?.body??null}))};
}
