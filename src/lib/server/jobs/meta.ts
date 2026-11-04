import 'server-only';
import { buildCapiEvent, capiEventAgeStatus, retryDelaySeconds, type CapiInput } from '@/lib/domain/capi';
import { type JobContext, loadJobSettings, localClock } from './shared';

export interface InsightRow { date_start: string; ad_id: string; account_id?: string; campaign_id?: string; campaign_name?: string; adset_id?: string; adset_name?: string; ad_name?: string; spend?: string; impressions?: string; clicks?: string; inline_link_clicks?: string; actions?: { action_type: string; value: string }[] }
export function metaLeadCount(actions: InsightRow['actions']): number {
  // `lead` is the aggregate. Do not add it to its onsite/offsite components.
  const aggregate = actions?.find((action) => action.action_type === 'lead');
  if (aggregate) return Math.max(0, Number(aggregate.value) || 0);
  return (actions ?? []).filter((action) => ['onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead'].includes(action.action_type)).reduce((sum, action) => sum + Math.max(0, Number(action.value) || 0), 0);
}
function safeNumber(value: string | undefined) { const number = Number(value ?? 0); if (!Number.isFinite(number) || number < 0) throw new Error('invalid_insights_metric'); return number; }
export function insightToRow(row: InsightRow, importedAt: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date_start) || !row.ad_id) throw new Error('invalid_insights_row');
  return { date: row.date_start, ad_id: row.ad_id, account_id: row.account_id, campaign_id: row.campaign_id, campaign_name: row.campaign_name, adset_id: row.adset_id, adset_name: row.adset_name, ad_name: row.ad_name, spend: safeNumber(row.spend), impressions: Math.round(safeNumber(row.impressions)), clicks: Math.round(safeNumber(row.clicks)), link_clicks: Math.round(safeNumber(row.inline_link_clicks)), meta_leads: Math.round(metaLeadCount(row.actions)), imported_at: importedAt };
}
function graphVersion(): string { const version = process.env.META_API_VERSION || 'v26.0'; if (!/^v\d+\.\d+$/.test(version)) throw new Error('invalid_meta_version'); return version; }
export function adsReady() { return Boolean(process.env.META_ADS_READ_TOKEN && process.env.META_AD_ACCOUNT_ID); }
export function capiReady() { return Boolean(process.env.META_CAPI_TOKEN && process.env.META_PIXEL_ID); }

export async function importAdSpend(context: JobContext): Promise<number> {
  const account = process.env.META_AD_ACCOUNT_ID?.replace(/^act_/, '');
  if (!account || !/^\d+$/.test(account) || !process.env.META_ADS_READ_TOKEN) throw new Error('ads_not_configured');
  const until = localClock(context.now).day, start = new Date(`${until}T12:00:00Z`); start.setUTCDate(start.getUTCDate() - 6);
  const endpoint = new URL(`https://graph.facebook.com/${graphVersion()}/act_${account}/insights`);
  endpoint.searchParams.set('level', 'ad'); endpoint.searchParams.set('time_increment', '1'); endpoint.searchParams.set('limit', '500');
  endpoint.searchParams.set('time_range', JSON.stringify({ since: start.toISOString().slice(0, 10), until }));
  endpoint.searchParams.set('fields', 'account_id,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,clicks,inline_link_clicks,actions,date_start,date_stop');
  let count = 0, cursor: string | undefined;
  const seen = new Set<string>();
  for (let page = 0; page < 200; page++) {
    if (cursor) endpoint.searchParams.set('after', cursor);
    const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${process.env.META_ADS_READ_TOKEN}` }, signal: AbortSignal.timeout(15_000), cache: 'no-store' });
    if (!response.ok) throw new Error('insights_provider_failed');
    const payload = await response.json() as { data?: InsightRow[]; error?: unknown; paging?: { next?: string; cursors?: { after?: string } } };
    if (payload.error || !Array.isArray(payload.data)) throw new Error('invalid_insights_response');
    const rows = payload.data.map((row) => insightToRow(row, context.now.toISOString()));
    if (rows.length) {
      const saved = await context.db.from('ad_spend_daily').upsert(rows, { onConflict: 'date,ad_id' });
      if (saved.error) throw new Error('insights_save_failed');
      count += rows.length;
    }
    if (!payload.paging?.next) return count;
    // Use only the cursor; never follow a provider-supplied URL carrying credentials.
    cursor = payload.paging.cursors?.after;
    if (!cursor || seen.has(cursor)) throw new Error('insights_pagination_invalid');
    seen.add(cursor);
  }
  throw new Error('insights_page_limit_reached');
}

export async function queueCapi(context: JobContext): Promise<number> {
  if (!context.settings.capi.enabled) return 0;
  const candidates = await context.db.rpc('capi_candidates', { p_limit: 100 });
  if (candidates.error) throw new Error('capi_candidates_failed');
  let count = 0;
  for (const input of (candidates.data ?? []) as CapiInput[]) {
    const eventId = `crm:${input.deal_id}:${input.milestone}`, eventTime = Math.floor(new Date(input.reached_at).getTime() / 1000);
    let payload: unknown, status = 'pending', reason: string | null = null;
    if (capiEventAgeStatus(eventTime, context.now.getTime() / 1000) === 'expired') {
      payload = { event_id: eventId, event_time: eventTime, event_name: input.event_name }; status = 'skipped'; reason = 'event_older_than_seven_days';
    } else {
      try { payload = buildCapiEvent({ ...input, value_once: input.value_once == null ? undefined : Number(input.value_once) }); }
      catch { payload = { event_id: eventId, event_time: eventTime, event_name: input.event_name }; status = 'skipped'; reason = 'invalid_event_data'; }
    }
    const saved = await context.db.from('capi_outbox').upsert({ deal_id: input.deal_id, event_id: eventId, event_name: input.event_name, payload, status, last_error: reason }, { onConflict: 'event_id', ignoreDuplicates: true });
    if (saved.error) throw new Error('capi_queue_failed');
    count++;
  }
  return count;
}
export async function deliverCapi(context: JobContext): Promise<number> {
  if (!(await loadJobSettings(context.db)).capi.enabled || !capiReady()) return 0;
  const claimed = await context.db.rpc('claim_capi', { p_limit: 20 });
  if (claimed.error) throw new Error('capi_claim_failed');
  let count = 0;
  for (const row of claimed.data ?? []) {
    const current = await loadJobSettings(context.db);
    if (!current.capi.enabled) {
      await context.db.from('capi_outbox').update({ status: 'pending', locked_at: null }).eq('id', row.id);
      continue;
    }
    const age = capiEventAgeStatus(Number(row.payload.event_time), context.now.getTime() / 1000);
    if (age !== 'ready' || String(row.event_name).toLowerCase() === 'lead') {
      await context.db.from('capi_outbox').update({ status: age === 'future' ? 'failed' : 'skipped', locked_at: null, last_error: age === 'expired' ? 'event_older_than_seven_days' : age === 'future' ? 'event_in_future' : 'lead_not_allowed', next_attempt_at: new Date(context.now.getTime() + 300_000).toISOString() }).eq('id', row.id);
      continue;
    }
    try {
      const pixel = process.env.META_PIXEL_ID!;
      if (!/^\d+$/.test(pixel)) throw new Error('invalid_dataset_id');
      const response = await fetch(`https://graph.facebook.com/${graphVersion()}/${pixel}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.META_CAPI_TOKEN}` }, body: JSON.stringify({ data: [row.payload], ...(current.capi.test_event_code ? { test_event_code: current.capi.test_event_code } : {}) }), signal: AbortSignal.timeout(10_000), cache: 'no-store' });
      const result = await response.json() as { events_received?: number; error?: { code?: number; is_transient?: boolean } };
      if (!response.ok || result.error || result.events_received !== 1) {
        const retry = response.status === 429 || response.status >= 500 || result.error?.is_transient === true;
        await context.db.from('capi_outbox').update({ status: retry ? 'failed' : 'skipped', locked_at: null, last_error: `meta_http_${response.status}_code_${Number(result.error?.code) || 0}`, next_attempt_at: new Date(context.now.getTime() + retryDelaySeconds(Number(row.attempts)) * 1000).toISOString() }).eq('id', row.id);
        continue;
      }
      const saved = await context.db.from('capi_outbox').update({ status: 'sent', sent_at: context.now.toISOString(), locked_at: null, last_error: null }).eq('id', row.id);
      if (saved.error) throw new Error('capi_status_save_failed');
      count++;
    } catch {
      // The stable event_id lets Meta deduplicate a retry after an ambiguous network result.
      await context.db.from('capi_outbox').update({ status: 'failed', locked_at: null, last_error: 'provider_request_unconfirmed', next_attempt_at: new Date(context.now.getTime() + retryDelaySeconds(Number(row.attempts)) * 1000).toISOString() }).eq('id', row.id);
    }
  }
  return count;
}
