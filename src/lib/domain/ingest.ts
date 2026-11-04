import { z } from 'zod';
import { normalizeEmail, normalizePhone, displayPhone } from './phone';
import { isStopMessage } from './messaging';
import { parsePromiseDate } from './time';

const text = (max: number) => z.string().trim().max(max).optional().default('');
const timestamp = z.string().trim().datetime({ offset: true });
const identity = { name: z.string().trim().min(1, 'Name is required').max(200), phone: text(50), email: text(254), business: text(200) };
const detailPairs = z.record(z.string().trim().min(1).max(200), z.string().trim().max(2000)).refine((value) => Object.keys(value).length <= 10, 'At most 10 details are allowed');
function checkContact(value: { phone: string; email: string }, context: z.RefinementCtx) {
  if (!value.phone && !value.email) context.addIssue({ code: 'custom', path: ['phone'], message: 'A phone or email is required' });
  if (value.phone && !normalizePhone(value.phone)) context.addIssue({ code: 'custom', path: ['phone'], message: 'Enter a valid phone number' });
  if (value.email && !normalizeEmail(value.email)) context.addIssue({ code: 'custom', path: ['email'], message: 'Enter a valid email address' });
}
export const websiteLeadSchema = z.object({
  ...identity, website: text(500), service: text(100), message: text(5000), source: text(100),
  page_url: text(2000), referrer: text(2000), landing_url: text(2000), landing_referrer: text(2000),
  utm_source: text(200), utm_medium: text(200), utm_campaign: text(300), utm_term: text(300), utm_content: text(300),
  event_id: z.string().trim().min(1, 'Event ID is required').max(100), fbp: text(200), fbc: text(500), promise: text(80),
  details: detailPairs.optional().default({}), received_at: timestamp.optional(),
}).superRefine(checkContact);

export const metaLeadSchema = z.object({
  ...identity,
  leadgen_id: z.string().trim().min(1, 'Lead ID is required').max(100), form_id: text(100), form_name: text(300), created_time: timestamp.optional(),
  ad_id: text(100), ad_name: text(300), adset_id: text(100), adset_name: text(300), campaign_id: text(100), campaign_name: text(300), platform: text(50), is_organic: z.boolean().optional().default(false),
  answers: z.array(z.object({ label: z.string().trim().min(1).max(200), value: z.string().trim().max(2000) })).max(10).optional().default([]),
}).superRefine(checkContact);

export const chloeEventSchema = z.object({
  type: z.enum(['started', 'message_in', 'message_out', 'fields', 'booked', 'rescheduled', 'cancelled', 'handoff', 'stopped', 'done', 'human']),
  phone: z.string().trim().max(16).regex(/^\+[1-9]\d{7,14}$/, 'Use E.164 format').refine((phone) => normalizePhone(phone) === phone, 'Enter a valid E.164 phone number'),
  lead_id: text(100), at: timestamp, text: text(5000),
  status: z.enum(['queued', 'active', 'booked', 'handoff', 'done', 'stopped', 'human']).optional(),
  fields: z.object({ trade: z.string().trim().max(2000), areas: z.string().trim().max(2000), current_website: z.string().trim().max(2000), goals: z.string().trim().max(2000), logo_and_photos: z.string().trim().max(2000), timing: z.string().trim().max(2000), decision_makers: z.string().trim().max(2000), notes: z.string().trim().max(2000) }).partial().optional().default({}),
  call_time: timestamp.optional(), reason: text(2000),
}).superRefine((value, context) => {
  if (['booked', 'rescheduled'].includes(value.type) && !value.call_time) context.addIssue({ code: 'custom', path: ['call_time'], message: 'Call time is required for a booking' });
});

export type WebsiteLeadInput = z.infer<typeof websiteLeadSchema>;
export type MetaLeadInput = z.infer<typeof metaLeadSchema>;
export type ChloeEventInput = z.infer<typeof chloeEventSchema>;
function person(name: string, phone: string, email: string) {
  const [first_name, ...rest] = name.trim().split(/\s+/);
  return { first_name, last_name: rest.join(' '), phone_e164: normalizePhone(phone), phone_display: displayPhone(phone), email: normalizeEmail(email) };
}
export function websiteToRecord(value: WebsiteLeadInput, raw: unknown, now = new Date().toISOString()) {
  const received_at = value.received_at ?? now;
  const promised_due_at = value.promise ? parsePromiseDate(value.promise, received_at) : null;
  return {
    ...person(value.name, value.phone, value.email), business: value.business, website: value.website, website_url: value.website,
    trade: value.details['Your trade'] ?? value.details['Trade'] ?? '', service: value.service,
    title: value.business ? `${value.business} enquiry` : `${value.name} enquiry`, message: value.message,
    channel: value.source === 'business-card' ? 'business_card' : 'website', received_at,
    promised_text: value.promise || null, promised_due_at, promise_needs_review: Boolean(value.promise && !promised_due_at),
    attribution: {
      form_source: value.source, page_url: value.page_url, landing_url: value.landing_url, referrer: value.referrer, landing_referrer: value.landing_referrer,
      utm_source: value.utm_source, utm_medium: value.utm_medium, utm_campaign: value.utm_campaign, utm_term: value.utm_term, utm_content: value.utm_content,
      event_id: value.event_id, fbp: value.fbp, fbc: value.fbc, raw,
    },
  };
}
export function metaToRecord(value: MetaLeadInput, raw: unknown, now = new Date().toISOString()) {
  return {
    ...person(value.name, value.phone, value.email), business: value.business, website: '', website_url: '',
    trade: value.answers.find((answer) => /trade/i.test(answer.label))?.value ?? '', service: '',
    title: value.business ? `${value.business} enquiry` : `${value.name} enquiry`, message: '', channel: 'meta_form', received_at: value.created_time ?? now,
    attribution: { meta_lead_id: value.leadgen_id, meta_form_id: value.form_id, meta_form_name: value.form_name, meta_ad_id: value.ad_id, meta_ad_name: value.ad_name, meta_adset_id: value.adset_id, meta_adset_name: value.adset_name, meta_campaign_id: value.campaign_id, meta_campaign_name: value.campaign_name, platform: value.platform, is_organic: value.is_organic, raw },
  };
}
export function chloeToRecord(value: ChloeEventInput) {
  return { ...value, is_stop: value.type === 'stopped' || (value.type === 'message_in' && isStopMessage(value.text)) };
}
