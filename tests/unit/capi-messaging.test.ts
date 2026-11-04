import { describe, expect, it } from 'vitest';
import { buildCapiEvent, sha256, capiEventAgeStatus } from '@/lib/domain/capi';
import { smsSegments, isStopMessage, canMessage } from '@/lib/domain';
describe('Conversions API payloads', () => {
  const input = { deal_id: 'deal-1', contact_id: 'contact-1', milestone: 'suitable', reached_at: '2026-11-04T05:07:47Z', event_name: 'QualifiedLead', contact: { email: ' Person@EXAMPLE.com ', phone_e164: '+61491570156', first_name: 'Dave', last_name: 'Test' } };
  it('hashes normalised user data and keeps a stable event id', () => { const payload = buildCapiEvent(input); expect(payload.event_id).toBe('crm:deal-1:suitable'); expect(payload.user_data.em).toEqual([sha256('person@example.com')]); expect(payload.user_data.ph).toEqual([sha256('61491570156')]); expect(JSON.stringify(payload)).not.toContain('Person@'); });
  it('removes name punctuation while preserving UTF-8 characters', () => expect(buildCapiEvent({ ...input, contact: { first_name: ' Valéry ', last_name: "O’Neil" } }).user_data).toMatchObject({ fn: [sha256('valéry')], ln: [sha256('oneil')] }));
  it('uses conversion-leads fields only for instant-form leads', () => { const payload = buildCapiEvent({ ...input, attribution: { meta_lead_id: '1234567890123456' } }); expect(payload.action_source).toBe('system_generated'); expect(payload.user_data.lead_id).toBe('1234567890123456'); expect(payload.custom_data).toEqual({ event_source: 'crm', lead_event_source: 'Lumen CRM' }); expect(buildCapiEvent(input).custom_data).toBeUndefined(); });
  it('passes browser identifiers without hashing them', () => expect(buildCapiEvent({ ...input, attribution: { fbp: 'fb.1.123.456', fbc: 'fb.1.123.click' } }).user_data.fbp).toBe('fb.1.123.456'));
  it('never sends the website Lead event', () => expect(() => buildCapiEvent({ ...input, event_name: 'Lead' })).toThrow());
  it('limits Purchase to one-off value', () => expect(buildCapiEvent({ ...input, milestone: 'won', event_name: 'Purchase', value_once: 2200 }).custom_data).toEqual({ value: 2200, currency: 'AUD' }));
  it('skips events older than seven days without changing their timestamps', () => { expect(capiEventAgeStatus(1, 604802)).toBe('expired'); expect(capiEventAgeStatus(1, 604801)).toBe('ready'); expect(capiEventAgeStatus(2, 1)).toBe('future'); });
});
describe('SMS and consent', () => {
  it('counts GSM extension symbols and Unicode segments', () => { expect(smsSegments('a'.repeat(160)).segments).toBe(1); expect(smsSegments('a'.repeat(161)).segments).toBe(2); expect(smsSegments('^'.repeat(81)).segments).toBe(2); expect(smsSegments('😀'.repeat(36)).segments).toBe(2); expect(smsSegments('a'.repeat(460)).warning).toBe(true); });
  it('honours STOP with whitespace and casing', () => { expect(isStopMessage(' stop ')).toBe(true); expect(isStopMessage('Unsubscribe.')).toBe(true); expect(isStopMessage('Can you stop by tomorrow?')).toBe(false); });
  it('blocks channel opt-outs and do not contact', () => { expect(canMessage({ sms_opt_out_at: '2026-11-04T00:00:00Z' }, 'sms')).toBe(false); expect(canMessage({ do_not_contact: true }, 'email')).toBe(false); });
});
