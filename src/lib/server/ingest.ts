import 'server-only';
import { after } from 'next/server';
import { z } from 'zod';
import { adminClient } from '@/lib/supabase/admin';
import { verifyIngestSignature, ingestIdempotencyKey } from '@/lib/domain/security';
import { websiteLeadSchema, metaLeadSchema, chloeEventSchema, websiteToRecord, metaToRecord, chloeToRecord } from '@/lib/domain/ingest';
import { sendTelegram, telegramReady, ProviderError } from './providers';

export const MAX_INGEST_BYTES = 65_536;
export type IngestSource = 'website' | 'meta' | 'chloe';
class IngestError extends Error { constructor(public status: number, message: string) { super(message); } }
export async function readIngestBody(request: Request): Promise<string> {
  if (Number(request.headers.get('content-length')) > MAX_INGEST_BYTES) throw new IngestError(413, 'Request body is too large');
  if (!request.body) throw new IngestError(400, 'A JSON body is required');
  const reader = request.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_INGEST_BYTES) { await reader.cancel(); throw new IngestError(413, 'Request body is too large'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new IngestError(400, 'Request body must be UTF-8 JSON'); }
}

/** Claims only records already queued by the ingest transaction. Failed alerts remain retryable by jobs. */
async function notifyIngest(dealId: string) {
  if (!telegramReady()) return;
  const db = adminClient();
  const pending = await db.from('notifications_log').select('id,event_key').eq('entity_id', dealId).eq('channel', 'telegram').eq('status', 'pending').limit(5);
  for (const item of pending.data ?? []) {
    const claimed = await db.from('notifications_log').update({ status: 'processing' }).eq('id', item.id).eq('status', 'pending').select('id').maybeSingle();
    if (!claimed.data) continue;
    try {
      const text = item.event_key.startsWith('new_lead:') ? 'A new enquiry is waiting in Lumen CRM.' : 'An enquiry has an update in Lumen CRM.';
      await sendTelegram(text, `/leads/${dealId}`);
      await db.from('notifications_log').update({ status: 'sent', sent_at: new Date().toISOString(), error: null }).eq('id', item.id);
    } catch (error) {
      await db.from('notifications_log').update({ status: 'failed', error: error instanceof ProviderError ? `${error.provider}:${error.status ?? 'unconfirmed'}` : 'notification_unavailable' }).eq('id', item.id);
    }
  }
}

export async function handleIngest(request: Request, source: IngestSource): Promise<Response> {
  try {
    const secret = process.env.CRM_INGEST_SECRET;
    if (!secret || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) throw new IngestError(503, 'Integration is not configured');
    const rawBody = await readIngestBody(request);
    if (!verifyIngestSignature(rawBody, request.headers.get('x-lumen-timestamp'), request.headers.get('x-lumen-signature'), secret)) throw new IngestError(401, 'Invalid signature');
    const db = adminClient();
    const limited = await db.rpc('consume_rate_limit', { p_key: `ingest:${source}`, p_limit: 60, p_window_seconds: 60 });
    if (limited.error) throw new IngestError(500, 'The enquiry could not be saved');
    if (limited.data !== true) return Response.json({ error: 'Rate limit exceeded', retry_after: 60 }, { status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } });
    let raw: unknown;
    try { raw = JSON.parse(rawBody); } catch { throw new IngestError(400, 'Invalid JSON'); }
    let input: Record<string, unknown>, key: string;
    if (source === 'website') {
      const value = websiteLeadSchema.parse(raw);
      input = websiteToRecord(value, raw); key = ingestIdempotencyKey(source, value);
    } else if (source === 'meta') {
      const value = metaLeadSchema.parse(raw);
      input = metaToRecord(value, raw); key = ingestIdempotencyKey(source, value);
    } else {
      const value = chloeEventSchema.parse(raw);
      input = chloeToRecord(value); key = ingestIdempotencyKey(source, value);
    }
    const result = source === 'chloe'
      ? await db.rpc('ingest_chloe', { p_key: key, p_input: input })
      : await db.rpc('ingest_lead', { p_source: source, p_key: key, p_input: input });
    if (result.error) {
      if (['22023', '23514', '23505'].includes(result.error.code ?? '')) throw new IngestError(400, 'The enquiry needs a contact identity review');
      throw new IngestError(500, 'The enquiry could not be saved');
    }
    const data = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!data || typeof data.deal_id !== 'string') throw new IngestError(500, 'The enquiry could not be saved');
    const appUrl = process.env.APP_URL || (process.env.NODE_ENV !== 'production' ? new URL(request.url).origin : '');
    if (!appUrl) throw new IngestError(503, 'Application URL is not configured');
    if (!data.duplicate) after(async () => { try { await notifyIngest(data.deal_id); } catch { /* A durable pending notification remains for the scheduled worker. */ } });
    return Response.json({ ok: true, deal_id: data.deal_id, url: new URL(`/leads/${data.deal_id}`, appUrl).toString(), duplicate: Boolean(data.duplicate) }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: 'Invalid input', fields: error.flatten().fieldErrors }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    if (error instanceof IngestError) return Response.json({ error: error.message }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
    return Response.json({ error: 'The enquiry could not be saved' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
