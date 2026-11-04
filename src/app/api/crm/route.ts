import { z } from 'zod';
import { requireSession, requireSameOrigin, HttpError, apiError } from '@/lib/server/auth';
import { loadCrm } from '@/lib/server/data';

const id = z.uuid();
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const date = z.iso.datetime({ offset: true }).nullable().optional();
const updateDeal = z.object({
  // Settings owns the stage keys; the database checks membership and quote/won evidence atomically.
  action: z.literal('update_deal'), id, stage_key: z.string().trim().min(1).max(100).optional(),
  outcome: z.enum(['open', 'won', 'lost', 'unsuitable', 'noreply']).optional(), lost_reason: optionalText(1000), override_reason: optionalText(1000),
  next_step: optionalText(500), next_step_at: date, promised_text: optionalText(80), promised_due_at: date,
  presales_minutes: z.number().min(0).max(100000).optional(), demo_build_minutes: z.number().min(0).max(100000).optional(),
}).strict();
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create_lead'), first_name: z.string().trim().min(1).max(200), last_name: optionalText(200), business_name: optionalText(200), trade: optionalText(200), suburb: optionalText(200), phone: optionalText(50), email: z.union([z.email().max(254), z.literal(''), z.null()]).optional(), channel: z.enum(['website', 'meta_form', 'chloe', 'referral', 'phone', 'business_card', 'manual', 'other']), next_step: optionalText(500), next_step_at: date, notes: optionalText(5000) }).strict(),
  updateDeal,
  z.object({ action: z.literal('add_note'), deal_id: id, body: z.string().trim().min(1).max(10000) }).strict(),
  z.object({ action: z.literal('create_task'), deal_id: id.nullable().optional(), title: z.string().trim().min(1).max(500), due_at: date, priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal') }).strict(),
  z.object({ action: z.literal('complete_task'), id, done: z.boolean() }).strict(),
  z.object({ action: z.literal('log_call'), deal_id: id, result: z.enum(['reached', 'connected', 'no_answer', 'voicemail', 'wrong_number', 'busy']), body: optionalText(10000), next_step: optionalText(500), next_step_at: date }).strict(),
  z.object({ action: z.literal('create_appointment'), deal_id: id, starts_at: z.iso.datetime({ offset: true }), ends_at: z.iso.datetime({ offset: true }), kind: z.enum(['call', 'meeting', 'demo_walkthrough']), notes: optionalText(5000) }).strict(),
  z.object({ action: z.literal('archive_record'), entity: z.enum(['activities', 'tasks', 'appointments', 'deals']), id }).strict(),
  z.object({ action: z.literal('touch_deal'), id }).strict(),
  z.object({ action: z.literal('merge_deals'), keep_id: id, merge_id: id }).strict(),
  z.object({ action: z.literal('record_consent'), contact_id: id, channel: z.enum(['sms', 'email']), status: z.enum(['opt_in', 'opt_out']), evidence: z.string().trim().min(1).max(2000) }).strict(),
  z.object({ action: z.literal('update_contact'), id, first_name: z.string().trim().min(1).max(200), last_name: optionalText(200), phone: optionalText(50), email: z.union([z.email(), z.literal(''), z.null()]).optional(), preferred_channel: z.enum(['call', 'sms', 'email']).optional(), best_time: optionalText(200), do_not_contact: z.boolean().optional() }).strict(),
  z.object({ action: z.literal('update_business'), id, name: z.string().trim().min(1).max(200), trade: optionalText(200), suburb: optionalText(200), website_url: z.union([z.url({ protocol: /^https?$/ }), z.literal(''), z.null()]).optional(), service_areas: z.array(z.string().max(200)).max(50).optional() }).strict(),
]);
export async function GET(request: Request) {
  try { const detail = z.uuid().safeParse(new URL(request.url).searchParams.get('detail_id')); return Response.json({ data: await loadCrm(undefined, detail.success ? detail.data : undefined) }, { headers: { 'Cache-Control': 'private, no-store' } }); } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const session = await requireSession(['owner', 'staff']);
    const { db, profile } = session;
    if (Number(request.headers.get('content-length')) > 30000) throw new HttpError(413, 'This change is too large.');
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: 'Please check the highlighted fields.', fields: parsed.error.flatten() }, { status: 400 });
    const input = parsed.data;
    let undo: Record<string, unknown> | undefined;
    let mutationResult: { deal_id?: string; duplicate?: boolean } | undefined;
    const check = (result: { error: { message: string } | null }) => { if (result.error) throw new HttpError(400, 'This change is not allowed. Check required fields, stage rules and your access.'); };
    if (input.action === 'create_lead') {
      const { normalizePhone } = await import('@/lib/domain');
      const phone = input.phone ? normalizePhone(input.phone) : null;
      if (!phone && !input.email) throw new HttpError(400, 'Add a valid phone number or email.');
      const result = await db.rpc('create_lead', { p_input: { ...input, phone_e164: phone, name: [input.first_name, input.last_name].filter(Boolean).join(' '), business: input.business_name } });
      check(result);
      mutationResult = { deal_id: result.data?.deal_id, duplicate: Boolean(result.data?.duplicate) };
      if (profile.role === 'owner' && !result.data?.duplicate) undo = { action: 'archive_record', entity: 'deals', id: result.data?.deal_id };
    } else if (input.action === 'update_deal') {
      const before = await db.from('deals').select('*').eq('id', input.id).single(); check(before);
      const { action: _action, id: dealId, override_reason, ...patch } = input;
      check(await db.rpc('patch_deal', { p_deal_id: dealId, p_patch: patch, p_override_reason: override_reason || null }));
      undo = { action: 'update_deal', id: dealId, ...Object.fromEntries(Object.keys(patch).map(key => [key, before.data[key]])) };
    } else if (input.action === 'add_note') {
      const result = await db.from('activities').insert({ deal_id: input.deal_id, type: 'note', body: input.body, occurred_at: new Date().toISOString(), created_by: profile.id }).select('id').single(); check(result);
      if (profile.role === 'owner' && result.data) undo = { action: 'archive_record', entity: 'activities', id: result.data.id };
    } else if (input.action === 'create_task') {
      const { action: _action, ...task } = input;
      const result = await db.from('tasks').insert({ ...task, created_by: profile.id }).select('id').single(); check(result);
      if (profile.role === 'owner' && result.data) undo = { action: 'archive_record', entity: 'tasks', id: result.data.id };
    } else if (input.action === 'complete_task') {
      check(await db.from('tasks').update({ done_at: input.done ? new Date().toISOString() : null }).eq('id', input.id));
      undo = { action: 'complete_task', id: input.id, done: !input.done };
    } else if (input.action === 'log_call') {
      check(await db.rpc('log_call', { p_deal_id: input.deal_id, p_outcome: input.result === 'connected' ? 'reached' : input.result, p_body: input.body || '', p_next_step: input.next_step || null, p_next_step_at: input.next_step_at || null }));
    } else if (input.action === 'create_appointment') {
      if (new Date(input.ends_at) <= new Date(input.starts_at)) throw new HttpError(400, 'End time must follow start time.');
      const { action: _action, ...appointment } = input;
      const result = await db.from('appointments').insert({ ...appointment, source: 'manual', status: 'booked' }).select('id').single(); check(result);
      if (profile.role === 'owner' && result.data) undo = { action: 'archive_record', entity: 'appointments', id: result.data.id };
    } else if (input.action === 'archive_record') {
      if (profile.role !== 'owner') throw new HttpError(403, 'Only the owner can delete records.');
      check(await db.from(input.entity).update({ deleted_at: new Date().toISOString() }).eq('id', input.id));
    } else if (input.action === 'touch_deal') {
      check(await db.from('deals').update({ first_touch_at: new Date().toISOString() }).eq('id', input.id).is('first_touch_at', null));
    } else if (input.action === 'merge_deals') {
      if (profile.role !== 'owner') throw new HttpError(403, 'Only the owner can merge deals.');
      check(await db.rpc('merge_deals', { p_keep_id: input.keep_id, p_merge_id: input.merge_id }));
    } else if (input.action === 'record_consent') {
      check(await db.rpc('record_consent', { p_contact_id: input.contact_id, p_channel: input.channel, p_status: input.status, p_source: 'manual', p_evidence: input.evidence }));
    } else if (input.action === 'update_contact') {
      const { normalizePhone } = await import('@/lib/domain');
      const { action: _action, id: contactId, phone, email, ...patch } = input;
      const normalized = phone ? normalizePhone(phone) : null;
      if (phone && !normalized) throw new HttpError(400, 'Enter a valid phone number.');
      const before = await db.from('contacts').select('*').eq('id', contactId).single(); check(before);
      check(await db.from('contacts').update({ ...patch, ...(phone !== undefined ? { phone_e164: normalized, phone_display: phone } : {}), ...(email !== undefined ? { email: email?.trim().toLowerCase() || null } : {}) }).eq('id', contactId));
      undo = { action: 'update_contact', id: contactId, first_name: before.data.first_name, last_name: before.data.last_name, phone: before.data.phone_e164, email: before.data.email, preferred_channel: before.data.preferred_channel, best_time: before.data.best_time, do_not_contact: before.data.do_not_contact };
    } else if (input.action === 'update_business') {
      const { action: _action, id: businessId, ...patch } = input;
      const before = await db.from('businesses').select('*').eq('id', businessId).single(); check(before);
      check(await db.from('businesses').update(patch).eq('id', businessId));
      undo = { action: 'update_business', id: businessId, ...Object.fromEntries(Object.keys(patch).map(key => [key, before.data[key]])) };
    }
    const detail = z.uuid().safeParse(new URL(request.url).searchParams.get('detail_id'));
    return Response.json({ data: await loadCrm(session, detail.success ? detail.data : undefined), undo, result: mutationResult });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: 'Invalid JSON.' }, { status: 400 });
    return apiError(error);
  }
}
