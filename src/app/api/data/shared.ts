import { HttpError, requireSession } from '@/lib/server/auth';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
export type SessionDb = Awaited<ReturnType<typeof requireSession>>['db'];
export const DATA_ENTITIES = ['contacts','businesses','deals','deal_milestones','attribution','activities','tasks','appointments','demos','products','quotes','quote_items','projects','checklist_items','subscriptions','invoices','invoice_items','payments','ad_spend_daily','templates','automations','consents','files','tags','taggings','saved_views','profiles','settings','audit_log','integration_inbox','notifications_log','message_drafts','capi_outbox','job_runs','import_batches','import_rows'] as const;
export const BIN_ENTITIES = ['contacts','businesses','deals','activities','tasks','appointments','demos','projects','quotes','quote_items','subscriptions','invoices','invoice_items','payments','files','tags','taggings','saved_views','message_drafts'] as const;
export const PRIVATE_EXPORT_COLUMNS = new Set(['public_token','token_hash','p256dh','auth','endpoint']);
export const noStore = { 'Cache-Control':'private, no-store' };
export async function downloadResponse(db:SessionDb,profileId:string,name:string,content:string|Uint8Array,mime:string) {
  const bytes=typeof content==='string'?new TextEncoder().encode(content):content;
  if(bytes.length<=4_000_000) return new Response(bytes as BodyInit,{headers:{...noStore,'Content-Type':mime,'Content-Disposition':'attachment; filename="'+name+'"'}});
  if(bytes.length>50*1024*1024) throw new HttpError(413,'This export exceeds 50 MB. Choose a narrower created-date range.');
  const path=profileId+'/'+randomUUID()+'/'+name;
  const uploaded=await db.storage.from('crm-exports').upload(path,bytes,{contentType:mime,upsert:false,cacheControl:'0'});
  if(uploaded.error) throw new HttpError(503,'The private export could not be prepared.');
  const queued=await db.rpc('queue_export_cleanup',{p_path:path});
  if(queued.error) { await db.storage.from('crm-exports').remove([path]);throw new HttpError(503,'Export cleanup could not be scheduled.'); }
  const signed=await db.storage.from('crm-exports').createSignedUrl(path,60,{download:name});
  if(signed.error || !signed.data) throw new HttpError(503,'The private download link could not be created.');
  return new Response(null,{status:303,headers:{...noStore,Location:signed.data.signedUrl}});
}
export function cleanExport(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !PRIVATE_EXPORT_COLUMNS.has(key)));
}
export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  if (Number(request.headers.get('content-length')) > maxBytes) throw new HttpError(413,'This request is too large.');
  const body = await request.text();
  if (new TextEncoder().encode(body).length > maxBytes) throw new HttpError(413,'This request is too large.');
  try { return JSON.parse(body); } catch { throw new HttpError(400,'Use a valid JSON request.'); }
}
export function validUuid(value: string | null): string {
  const parsed = z.uuid().safeParse(value); if (!parsed.success) throw new HttpError(400,'Choose a valid record.'); return parsed.data;
}
export async function collectRows(db: SessionDb, entity: string, ids?: string[], includeDeleted = true, from?: string, to?: string) {
  const rows: Record<string, unknown>[] = [];
  for (let start = 0; start <= 10000; start += 1000) {
    let query = db.from(entity).select('*').order('id').range(start,start + 999);
    if (ids?.length) query = query.in('id',ids);
    if (!includeDeleted && (BIN_ENTITIES as readonly string[]).includes(entity)) query = query.is('deleted_at',null);
    if (from) query = query.gte('created_at',from);
    if (to) query = query.lt('created_at',to);
    const result = await query;
    if (result.error) throw new HttpError(503,'The requested records could not be exported.');
    rows.push(...(result.data || []).map(cleanExport));
    if (rows.length > 10000) throw new HttpError(413,'This export exceeds 10,000 rows. Export a narrower created-date range.');
    if ((result.data?.length || 0) < 1000) break;
  }
  return rows;
}
