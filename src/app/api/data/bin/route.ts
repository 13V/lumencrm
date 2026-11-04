import { z } from 'zod';
import { apiError, HttpError, requireSession, requireSameOrigin } from '@/lib/server/auth';
import { BIN_ENTITIES,noStore,readJson } from '../shared';
export async function GET() {
  try {
    const {db}=await requireSession(['owner']);
    const cutoff=new Date(Date.now()-30*86400000).toISOString();
    const results=await Promise.all(BIN_ENTITIES.map(async entity=>{
      const result=await db.from(entity).select('*').gte('deleted_at',cutoff).order('deleted_at',{ascending:false}).limit(100);
      if(result.error) throw new HttpError(503,'The bin could not be loaded.');
      return (result.data || []).filter(row=>!row.anonymised_at && !row.merged_into_id && (!row.upload_status || row.upload_status==='ready')).map(row=>({entity,id:row.id,label:String(row.title || row.name || row.number || [row.first_name,row.last_name].filter(Boolean).join(' ') || row.description || row.type || 'Record'),deleted_at:row.deleted_at}));
    }));
    return Response.json({items:results.flat().sort((a,b)=>b.deleted_at.localeCompare(a.deleted_at))},{headers:noStore});
  } catch(error) { return apiError(error); }
}
export async function POST(request:Request) {
  try {
    requireSameOrigin(request);const {db}=await requireSession(['owner']);
    const input=z.object({entity:z.enum(BIN_ENTITIES),id:z.uuid()}).strict().safeParse(await readJson(request,1000));
    if(!input.success) throw new HttpError(400,'Choose a record from the bin.');
    const result=await db.rpc('restore_deleted',{p_entity:input.data.entity,p_id:input.data.id});
    if(result.error) throw new HttpError(400,'This record cannot be restored. It may be anonymised, merged or outside the 30-day bin period.');
    return Response.json({ok:true,record:result.data},{headers:noStore});
  } catch(error) { return apiError(error); }
}
