import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { apiError, HttpError, requireSameOrigin, requireSession } from '@/lib/server/auth';
import { CsvError, parseCsv, previewImport, suggestMapping, type CsvMapping, type ImportPreviewRow } from '@/lib/domain/csv';
import { noStore, readJson, type SessionDb } from '../shared';

export const maxDuration = 60;
const schema = z.object({ csv:z.string().max(2_000_000),mapping:z.record(z.string(),z.string().max(200)).optional(),dry_run:z.boolean(),entity:z.enum(['contacts','deals']).default('deals'),request_id:z.uuid().optional() }).strict();
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
interface Match { id:string; phone_e164:string|null; email:string|null; deleted_at:string|null; business_id:string|null }
async function matches(db: SessionDb, rows: ImportPreviewRow[]) {
  const phones = [...new Set(rows.map(row=>row.input.phone_e164).filter((v):v is string=>typeof v==='string'))];
  const emails = [...new Set(rows.map(row=>row.input.email).filter((v):v is string=>typeof v==='string'))];
  const found = new Map<string,Match>();
  for (const [field,values] of [['phone_e164',phones],['email',emails]] as const) {
    for(let offset=0;offset<values.length;offset+=100) {
      const result = await db.from('contacts').select('id,phone_e164,email,deleted_at,business_id').in(field,values.slice(offset,offset+100));
      if(result.error) throw new HttpError(503,'Duplicate checking is unavailable. Nothing has been imported.');
      for(const contact of result.data || []) found.set(contact.id,contact as Match);
    }
  }
  const contacts=[...found.values()], ids=contacts.map(c=>c.id), open=new Map<string,string>();
  for(let offset=0;offset<ids.length;offset+=100) {
    const result=await db.from('deals').select('id,contact_id').in('contact_id',ids.slice(offset,offset+100)).eq('outcome','open').is('deleted_at',null).order('created_at');
    if(result.error) throw new HttpError(503,'Duplicate checking is unavailable. Nothing has been imported.');
    for(const deal of result.data || []) if(!open.has(deal.contact_id)) open.set(deal.contact_id,deal.id);
  }
  return rows.map(row=>{
    const contact=contacts.find(c=>c.phone_e164 && c.phone_e164===row.input.phone_e164) || contacts.find(c=>c.email && c.email.toLowerCase()===row.input.email);
    if(!contact) return row;
    return { ...row,errors:contact.deleted_at?[...row.errors,{field:'phone',message:'The matching contact is in the bin. Restore it before importing.'}]:row.errors,match:{contact_id:contact.id,deal_id:open.get(contact.id)||null,business_id:contact.business_id} };
  });
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);const {db}=await requireSession(['owner']);
    const parsed=schema.safeParse(await readJson(request,2_100_000));
    if(!parsed.success) return Response.json({error:'Check the CSV and column mapping.',fields:parsed.error.flatten()},{status:400});
    const input=parsed.data,table=parseCsv(input.csv);
    if(!table.rows.length) throw new HttpError(400,'The CSV has no data rows.');
    const mapping=(input.mapping || suggestMapping(table.headers)) as CsvMapping;
    const rows=await matches(db,previewImport(table,mapping,input.entity));
    const errors=rows.filter(row=>row.errors.length),requestId=input.request_id || randomUUID();
    if(input.dry_run) return Response.json({request_id:requestId,headers:table.headers,mapping,rows,valid_count:rows.length-errors.length,error_count:errors.length},{headers:noStore});
    if(!input.request_id) throw new HttpError(400,'Preview the CSV and include its request_id before importing.');
    if(errors.length) return Response.json({error:'Fix the rows with errors before importing.',request_id:requestId,rows:errors,error_count:errors.length},{status:400,headers:noStore});
    const contentHash=hash(JSON.stringify({csv:input.csv,mapping,entity:input.entity}));
    const batch=await db.rpc('prepare_import_batch',{p_id:requestId,p_hash:contentHash,p_entity:input.entity,p_total:rows.length});
    if(batch.error) throw new HttpError(batch.error.code==='23514'?409:400,batch.error.code==='23514'?'This import identifier belongs to different data. Preview again.':'The import could not be started.');
    let imported=0,skipped=0;const failed:{row:number;message:string}[]=[];
    // Each row is atomic. Committed receipts make interrupted requests safe to retry.
    for(let offset=0;offset<rows.length;offset+=50) {
      const group=rows.slice(offset,offset+50);
      const result=await db.rpc('import_lead_rows',{p_batch_id:requestId,p_rows:group.map(row=>({row:row.row,hash:hash(JSON.stringify(row.input)),input:row.input}))});
      if(result.error) { failed.push(...group.map(row=>({row:row.row,message:'This group could not be imported. Retry the same request to resume.'})));continue; }
      for(const row of (result.data || []) as {row:number;error?:string;skipped?:boolean}[]) {
        if(row.error) failed.push({row:row.row,message:row.error==='23514'?'This row conflicts with an existing record or a stage rule.':'This row could not be imported. Retry the same request to resume.'});
        else if(row.skipped) skipped++;else imported++;
      }
    }
    return Response.json({request_id:requestId,imported,skipped,errors:failed,complete:!failed.length},{status:failed.length?207:200,headers:noStore});
  } catch(error) {
    if(error instanceof CsvError) return Response.json({error:error.message},{status:400});
    return apiError(error);
  }
}
