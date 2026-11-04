import { z } from 'zod';
import { apiError, HttpError, requireSession } from '@/lib/server/auth';
import { exportCsv, zipEntries } from '@/lib/domain/csv';
import { collectRows, DATA_ENTITIES, downloadResponse } from '../shared';
export const maxDuration=60;
export async function GET(request: Request) {
  try {
    const {db,profile}=await requireSession(['owner']);const query=new URL(request.url).searchParams;
    const entity=query.get('entity') || 'contacts';
    if(entity!=='all' && !(DATA_ENTITIES as readonly string[]).includes(entity)) throw new HttpError(400,'Choose a supported export.');
    const ids=query.get('ids')?.split(',').filter(Boolean);
    if(ids && (ids.length>1000 || ids.some(id=>!z.uuid().safeParse(id).success))) throw new HttpError(400,'Choose at most 1,000 valid records.');
    const from=query.get('from') || undefined,to=query.get('to') || undefined;
    if([from,to].some(date=>date && !z.iso.datetime({offset:true}).safeParse(date).success)) throw new HttpError(400,'Date filters must be ISO timestamps with a timezone.');
    const stamp=new Date().toISOString().slice(0,10);
    if(entity==='all') {
      if(ids) throw new HttpError(400,'Use an entity export when selecting individual records.');
      const entries:{name:string;content:string}[]=[],counts:Record<string,number>={};let bytes=0;
      for(const table of DATA_ENTITIES) {
        const rows=await collectRows(db,table,undefined,true,from,to);
        const content=exportCsv(rows);bytes+=Buffer.byteLength(content);
        if(bytes>49*1024*1024) throw new HttpError(413,'This export exceeds 50 MB. Choose a narrower created-date range.');
        entries.push({name:table+'.csv',content});counts[table]=rows.length;
      }
      entries.push({name:'manifest.json',content:JSON.stringify({exported_at:new Date().toISOString(),counts,excluded:'Authentication material, bearer tokens, push endpoints and server environment secrets are excluded.'},null,2)});
      const zip=zipEntries(entries);
      return downloadResponse(db,profile.id,'lumen-export-'+stamp+'.zip',zip,'application/zip');
    }
    const rows=await collectRows(db,entity,ids,query.get('include_deleted')==='true',from,to);
    return downloadResponse(db,profile.id,'lumen-'+entity+'-'+stamp+'.csv',exportCsv(rows),'text/csv; charset=utf-8');
  } catch(error) { return apiError(error); }
}
