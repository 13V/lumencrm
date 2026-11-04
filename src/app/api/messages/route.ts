import { z } from 'zod';
import { apiError, HttpError, requireSameOrigin, requireSession } from '@/lib/server/auth';
import { canMessage, smsSegments } from '@/lib/domain/messaging';
import { emailReady, ProviderError, sendEmail, sendSms, smsReady } from '@/lib/server/providers';

export const runtime = 'nodejs';
const schema = z.object({
  deal_id: z.uuid(), request_id: z.uuid(), channel: z.enum(['sms', 'email']),
  body: z.string().trim().min(1).max(10000), subject: z.string().trim().max(200).optional(),
  confirm_long_sms: z.boolean().optional().default(false),
}).strict();

export async function GET(request: Request) {
  try {
    const { db } = await requireSession(['owner', 'staff']);
    const url = new URL(request.url);
    const parsed = z.object({ deal_id: z.uuid(), channel: z.enum(['sms', 'email']) }).safeParse({ deal_id: url.searchParams.get('deal_id'), channel: url.searchParams.get('channel') });
    if (!parsed.success) throw new HttpError(400, 'Choose a deal and message channel.');
    const { deal_id, channel } = parsed.data;
    const deal = await db.from('deals').select('contact_id').eq('id', deal_id).is('deleted_at', null).single();
    if (!deal.data) throw new HttpError(404, 'Deal not found.');
    const [contact, consents, templates] = await Promise.all([
      db.from('contacts').select('phone_e164,email,do_not_contact,sms_opt_out_at,email_opt_out_at').eq('id', deal.data.contact_id).is('deleted_at', null).single(),
      db.from('consents').select('status').eq('contact_id', deal.data.contact_id).eq('channel', channel).order('at', { ascending: false }).order('created_at', { ascending: false }).limit(1).maybeSingle(),
      db.from('templates').select('id,name,body,subject,channel').eq('channel', channel).eq('active', true).is('deleted_at', null).order('name'),
    ]);
    if (!contact.data || contact.error || consents.error || templates.error) throw new HttpError(500, 'Message details could not be loaded.');
    const address = channel === 'sms' ? contact.data.phone_e164 : contact.data.email;
    const permitted = canMessage(contact.data, channel);
    const reason = !permitted ? 'This contact has opted out. Sending is blocked.' : !address ? `Add a ${channel === 'sms' ? 'phone number' : 'email address'} first.` : consents.data?.status !== 'opt_in' ? 'Record consent before sending a message.' : null;
    return Response.json({ templates: templates.data ?? [], configured: channel === 'sms' ? smsReady() : emailReady(), consent: { allowed: !reason, reason }, takeover_configured: Boolean(process.env.CHLOE_TAKEOVER_URL) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const { db } = await requireSession(['owner', 'staff']);
    if (Number(request.headers.get('content-length')) > 20000) throw new HttpError(413, 'Message is too long.');
    const input = schema.safeParse(await request.json());
    if (!input.success) return Response.json({ error: 'Check the message fields.', fields: input.error.flatten().fieldErrors }, { status: 400 });
    const { deal_id, request_id, channel } = input.data;
    if (channel === 'sms' ? !smsReady() : !emailReady()) throw new HttpError(503, `${channel === 'sms' ? 'ClickSend' : 'Email'} is not configured. Use the phone or email app option.`);
    if (channel === 'email' && !input.data.subject) throw new HttpError(400, 'Add an email subject.');
    // The confirmed preview and sent text use the same identification and opt-out footer.
    let body = input.data.body;
    if (!/\blumen\b/i.test(body)) body += '\nTroy, Lumen adl';
    if (channel === 'sms' && !/reply\s+stop/i.test(body)) body += '\nReply STOP to opt out.';
    if (channel === 'email' && !/unsubscribe/i.test(body)) body += '\n\nTo stop receiving emails, reply unsubscribe.';
    const segments = channel === 'sms' ? smsSegments(body) : null;
    if (segments?.warning && !input.data.confirm_long_sms) return Response.json({ error: 'This text uses more than three segments. Confirm before sending.', segments: segments.segments, preview: body }, { status: 422 });
    const prepared = await db.rpc('prepare_message', { p_deal_id: deal_id, p_channel: channel, p_body: body, p_subject: input.data.subject || null, p_request_id: request_id });
    if (prepared.error) throw new HttpError(409, 'Texting or emailing is blocked. Check the contact’s consent, opt-out and contact details.');
    const result = Array.isArray(prepared.data) ? prepared.data[0] : prepared.data;
    if (!result?.activity_id) throw new HttpError(500, 'The message could not be prepared.');
    if (result.duplicate) return Response.json({ ok: true, duplicate: true, activity_id: result.activity_id, message: 'This send was already requested. Check the timeline before sending again.' });
    let delivery: { id: string; status: string };
    try {
      delivery = channel === 'sms'
        ? await sendSms(result.phone_e164, body)
        : await sendEmail(result.email, input.data.subject!, body, request_id);
    } catch (error) {
      const status = error instanceof ProviderError && error.uncertain ? 'unknown' : 'failed';
      await db.rpc('finalise_message', { p_activity_id: result.activity_id, p_status: status, p_provider_id: null });
      return Response.json({ error: error instanceof ProviderError ? error.message : 'The sending service is unavailable.', activity_id: result.activity_id, status }, { status: 502 });
    }
    const finalised = await db.rpc('finalise_message', { p_activity_id: result.activity_id, p_status: delivery.status, p_provider_id: delivery.id });
    if (finalised.error) return Response.json({ ok: true, activity_id: result.activity_id, status: 'queued', warning: 'The provider accepted the message but its status could not be saved. Do not resend; check the provider delivery log.' });
    return Response.json({ ok: true, activity_id: result.activity_id, status: delivery.status, segments: segments?.segments });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: 'Invalid JSON.' }, { status: 400 });
    return apiError(error);
  }
}
