import { after } from 'next/server';
import { z } from 'zod';
import { requireSession, requireSameOrigin, HttpError, apiError } from '@/lib/server/auth';
import { sendInvitationJob } from '@/lib/server/invitation-job';
import { templateVariableErrors } from '@/lib/domain/messaging';

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('configuration'), config: z.record(z.string(), z.unknown()), revision: z.number().int().nonnegative() }),
  z.object({ action: z.literal('product'), id: z.uuid().optional(), name: z.string().min(1).max(200), kind: z.enum(['once', 'monthly']), price: z.number().nonnegative().max(99999999), summary: z.string().max(2000), included: z.array(z.string().max(1000)).max(50), active: z.boolean() }),
  z.object({ action: z.literal('invite'), name: z.string().min(1).max(200), email: z.email(), role: z.enum(['owner', 'staff', 'viewer']) }),
  z.object({ action: z.literal('automation'), id: z.uuid(), enabled: z.boolean(), config: z.record(z.string(), z.unknown()).optional() }),
  z.object({ action: z.literal('template'), id: z.uuid().optional(), name: z.string().trim().min(1).max(200), channel: z.enum(['sms', 'email']), subject: z.string().trim().max(200).nullable().optional(), body: z.string().trim().min(1).max(10000), active: z.boolean() }).strict().superRefine((template, context) => {
    if (template.channel === 'sms' && template.body.length > 5000) context.addIssue({ code: 'custom', path: ['body'], message: 'A text template must be 5,000 characters or fewer.' });
    for (const field of ['body', 'subject'] as const) for (const message of templateVariableErrors(template[field] || '')) context.addIssue({ code: 'custom', path: [field], message });
  }),
]);
const configSchema = z.object({
  business: z.object({ trading_name: z.string().min(1).max(200), legal_name: z.string().max(200), email: z.union([z.email(), z.literal('')]), phone: z.string().max(50), abn: z.string().max(30), address: z.string().max(1000) }),
  speed_to_lead_minutes: z.number().min(1).max(120), retention_months: z.number().int().min(1).max(120),
  call_hours: z.object({ days: z.array(z.number().int().min(0).max(6)).min(1), start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), holidays: z.array(z.iso.date()), timeZone: z.literal('Australia/Adelaide') }).passthrough().refine(h => h.end > h.start, 'Call hours must end after they start.'),
  gst: z.object({ registered: z.boolean(), rate: z.number().min(0).max(1), wording: z.string().max(500) }),
  quotes: z.object({ terms_url: z.union([z.url({ protocol: /^https?$/ }), z.literal('')]), validity_days: z.number().int().min(1).max(365), deposit_percentage: z.number().min(0).max(100).nullable() }).passthrough(),
}).passthrough();
async function readSettings() {
  const { db } = await requireSession(['owner']);
  const [settings, products, automations, invitations, inbox, outbox, templates] = await Promise.all([
    db.from('settings').select('*').single(), db.from('products').select('*').is('deleted_at', null).order('sort'),
    db.from('automations').select('*').order('key'), db.from('user_invitations').select('id,name,email,role,accepted_at,expires_at').is('deleted_at', null).order('created_at', { ascending: false }),
    db.from('integration_inbox').select('source,received_at,status,error').order('received_at', { ascending: false }).limit(20),
    db.from('capi_outbox').select('id,event_name,status,attempts,last_error,sent_at').order('created_at', { ascending: false }).limit(50),
    db.from('templates').select('id,name,channel,subject,body,active').is('deleted_at', null).order('name'),
  ]);
  if (settings.error) throw new HttpError(503, 'Settings could not be loaded.');
  if (templates.error) throw new HttpError(503, 'Message templates could not be loaded.');
  return { config: settings.data.config, revision: settings.data.revision, templates: templates.data || [], products: products.data || [], automations: automations.data || [], invitations: invitations.data || [], inbox: inbox.data || [], outbox: outbox.data || [], integrations: { sms: Boolean(process.env.CLICKSEND_API_KEY), email: Boolean(process.env.RESEND_API_KEY), telegram: Boolean(process.env.TELEGRAM_BOT_TOKEN), chloe: Boolean(process.env.CHLOE_TAKEOVER_URL), meta: Boolean(process.env.META_CAPI_TOKEN), push: Boolean(process.env.VAPID_PRIVATE_KEY) } };
}
export async function GET() { try { return Response.json(await readSettings()); } catch (error) { return apiError(error); } }
export async function POST(request: Request) {
  try {
    requireSameOrigin(request); const { db, profile } = await requireSession(['owner']);
    const body = await request.text(); if (body.length > 100000) throw new HttpError(413, 'Settings are too large.');
    const parsed = schema.safeParse(JSON.parse(body)); if (!parsed.success) return Response.json({ error: 'Check the settings values.', fields: parsed.error.flatten() }, { status: 400 });
    const input = parsed.data;
    if (input.action === 'configuration') {
      const result = configSchema.safeParse(input.config); if (!result.success) return Response.json({ error: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join(' ') }, { status: 400 });
      const save = await db.rpc('save_settings', { p_config: result.data, p_expected_revision: input.revision });
      if (save.error) throw new HttpError(save.error.code === '40001' ? 409 : 400, save.error.code === '40001' ? 'Settings changed in another window. Reload before saving again.' : 'Settings could not be saved.');
    } else if (input.action === 'product') {
      const { action: _action, id, ...product } = input;
      const result = id ? await db.from('products').update(product).eq('id', id) : await db.from('products').insert(product);
      if (result.error) throw new HttpError(400, 'The product could not be saved.');
    } else if (input.action === 'template') {
      const { action: _action, id, ...template } = input;
      const values = { ...template, subject: template.channel === 'sms' ? null : template.subject || null };
      const result = await (id ? db.from('templates').update(values).eq('id', id).is('deleted_at', null) : db.from('templates').insert(values)).select('id').maybeSingle();
      if (result.error) throw new HttpError(400, 'The message template could not be saved.');
      if (!result.data) throw new HttpError(404, 'This message template is no longer available.');
    } else if (input.action === 'invite') {
      const { data, error } = await db.from('user_invitations').insert({ name: input.name, email: input.email.toLowerCase(), role: input.role, invited_by: profile.id }).select('id').single();
      if (error || !data) throw new HttpError(400, 'An invitation may already be pending for this address.');
      after(() => sendInvitationJob(data.id));
    } else {
      const result = await db.from('automations').update({ enabled: input.enabled, ...(input.config ? { config: input.config } : {}) }).eq('id', input.id);
      if (result.error) throw new HttpError(400, 'The automation could not be updated.');
    }
    return Response.json(await readSettings());
  } catch (error) { return apiError(error); }
}
