import { createHash } from 'node:crypto';
import { normalizePhone } from './phone';

export const CAPI_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;
export const DEFAULT_CAPI_MAPPING: Record<string, string> = { contacted: 'TwoWayContact', suitable: 'QualifiedLead', call_booked: 'Schedule', demo: 'DemoSent', quote: 'QuoteSent', won: 'Purchase' };
export function sha256(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }
export function normalizeMetaName(value: string): string { return value.trim().toLowerCase().replace(/\p{P}/gu, ''); }
export interface CapiInput {
  deal_id: string; contact_id: string; milestone: string; reached_at: string; event_name: string;
  contact: { email?: string | null; phone_e164?: string | null; first_name?: string | null; last_name?: string | null };
  attribution?: { meta_lead_id?: string | null; fbp?: string | null; fbc?: string | null };
  action_source?: 'email' | 'website' | 'phone_call' | 'chat' | 'other';
  event_source_url?: string; client_user_agent?: string; value_once?: number;
}
export function buildCapiEvent(input: CapiInput) {
  if (input.event_name.toLowerCase() === 'lead') throw new Error('The website owns the Lead event; CRM must not duplicate it');
  const event_time = Math.floor(new Date(input.reached_at).getTime() / 1000);
  if (!Number.isFinite(event_time)) throw new Error('Invalid milestone date');
  const user_data: Record<string, string | string[]> = {};
  const contact = input.contact;
  if (contact.email?.trim()) user_data.em = [sha256(contact.email.trim().toLowerCase())];
  const phone = normalizePhone(contact.phone_e164);
  if (phone) user_data.ph = [sha256(phone.replace(/\D/g, ''))];
  if (contact.first_name?.trim()) user_data.fn = [sha256(normalizeMetaName(contact.first_name))];
  if (contact.last_name?.trim()) user_data.ln = [sha256(normalizeMetaName(contact.last_name))];
  user_data.country = [sha256('au')];
  user_data.external_id = [sha256(input.contact_id)];
  const custom_data: Record<string, string | number> = {};
  const metaLead = input.attribution?.meta_lead_id;
  if (metaLead) {
    user_data.lead_id = metaLead;
    custom_data.event_source = 'crm';
    custom_data.lead_event_source = 'Lumen CRM';
  } else {
    if (input.attribution?.fbp) user_data.fbp = input.attribution.fbp;
    if (input.attribution?.fbc) user_data.fbc = input.attribution.fbc;
  }
  if (input.event_name === 'Purchase') {
    if (input.value_once === undefined || !Number.isFinite(input.value_once) || input.value_once < 0) throw new Error('Purchase needs the one-off build value');
    custom_data.value = input.value_once; custom_data.currency = 'AUD';
  }
  const action_source = metaLead ? 'system_generated' : input.action_source ?? 'other';
  if (action_source === 'website' && (!input.event_source_url || !input.client_user_agent)) throw new Error('Website events need the event URL and browser user agent');
  if (action_source === 'website') user_data.client_user_agent = input.client_user_agent!;
  return { event_name: input.event_name, event_time, event_id: `crm:${input.deal_id}:${input.milestone}`, action_source, user_data, ...(action_source === 'website' ? { event_source_url: input.event_source_url } : {}), ...(Object.keys(custom_data).length ? { custom_data } : {}) };
}
export function capiEventAgeStatus(eventTime: number, nowSeconds = Date.now() / 1000): 'ready' | 'expired' | 'future' {
  if (eventTime > nowSeconds) return 'future';
  return nowSeconds - eventTime > CAPI_MAX_AGE_SECONDS ? 'expired' : 'ready';
}
export function retryDelaySeconds(attempt: number): number { return Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1)); }
