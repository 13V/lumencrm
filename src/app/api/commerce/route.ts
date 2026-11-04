import { z } from 'zod';
import { requireSameOrigin, requireSession, apiError, HttpError } from '@/lib/server/auth';
import { loadCommerce } from '@/lib/server/commerce';
const id = z.uuid(); const text = z.string().trim().max(5000); const link = z.url({ protocol: /^https?$/ });
const line = z.object({ product_id: id.nullable().optional(), description: z.string().trim().min(1).max(1000), qty: z.number().positive().max(10000), unit_price: z.number().nonnegative().max(99999999), kind: z.enum(['once', 'monthly']).default('once'), included: z.boolean().default(false), sort: z.number().int().optional() });
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create_quote'), deal_id: id, items: z.array(line).min(1).max(100), expires_at: z.iso.datetime({ offset: true }).nullable().optional(), notes: text.nullable().optional() }),
  z.object({ action: z.literal('issue_quote'), id }),
  z.object({ action: z.literal('save_demo'), id: id.optional(), deal_id: id, status: z.enum(['to_build', 'building', 'sent', 'approved', 'superseded']), url: z.union([link, z.literal(''), z.null()]), notes: text.optional(), build_minutes: z.number().int().min(0).max(100000) }),
  z.object({ action: z.literal('check_item'), id, done: z.boolean() }),
  z.object({ action: z.literal('update_project'), id, stage_key: z.string().min(1).max(100).optional(), site_url: z.union([link, z.literal(''), z.null()]).optional(), feature_permission: z.enum(['unknown', 'asked', 'granted', 'declined']).optional(), feature_permission_note: text.nullable().optional() }),
  z.object({ action: z.literal('launch_project'), id, site_url: link }),
  z.object({ action: z.literal('subscription'), id, status: z.enum(['active', 'paused', 'cancelled']), reason: z.string().trim().min(1).max(1000) }),
  z.object({ action: z.literal('create_invoice'), business_id: id.nullable().optional(), contact_id: id.nullable().optional(), deal_id: id.nullable().optional(), project_id: id.nullable().optional(), subscription_id: id.nullable().optional(), issued_on: z.iso.date().optional(), due_on: z.iso.date().optional(), notes: text.optional(), items: z.array(line).min(1).max(100) }),
  z.object({ action: z.literal('invoice_from_quote'), quote_id: id, kind: z.enum(['deposit', 'balance']) }),
  z.object({ action: z.literal('payment'), invoice_id: id, amount: z.number().positive().max(99999999), received_on: z.iso.date(), method: z.enum(['bank_transfer', 'cash', 'card', 'other']), reference: z.string().max(200).optional() }),
]);
export async function GET(request: Request) {
  try {
    const dealId = new URL(request.url).searchParams.get('deal_id') || undefined;
    if (dealId && !id.safeParse(dealId).success) throw new HttpError(400, 'Choose a valid deal.');
    return Response.json({ data: await loadCommerce(undefined, dealId) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request); const session = await requireSession(['owner', 'staff']); const { db, profile } = session;
    const raw = await request.text(); if (raw.length > 100000) throw new HttpError(413, 'This request is too large.');
    const result = schema.safeParse(JSON.parse(raw)); if (!result.success) return Response.json({ error: 'Check the values before saving.', fields: result.error.flatten() }, { status: 400 });
    const input = result.data;
    if (profile.role === 'staff' && !['save_demo', 'check_item', 'update_project', 'launch_project'].includes(input.action)) throw new HttpError(403, 'Only the owner can change sales documents and billing.');
    const check = (r: { error: { message: string } | null }) => { if (r.error) throw new HttpError(400, 'The change could not be saved. Check required terms, prices, status and access.'); };
    let created: unknown;
    if (input.action === 'create_quote') { const r = await db.rpc('create_quote', { p_deal_id: input.deal_id, p_items: input.items, p_expires_at: input.expires_at || null, p_notes: input.notes || null }); check(r); created = r.data; }
    else if (input.action === 'issue_quote') { const r = await db.rpc('issue_quote', { p_quote_id: input.id }); check(r); created = r.data; }
    else if (input.action === 'save_demo') {
      const { action: _a, id: demoId, ...fields } = input;
      const patch = { ...fields, url: fields.url || null, ...(fields.status === 'sent' ? { sent_at: new Date().toISOString() } : {}) };
      if (input.status === 'sent' && !input.url) throw new HttpError(400, 'Add the demo link before marking it sent.');
      const r = demoId ? await db.from('demos').update(patch).eq('id', demoId) : await db.from('demos').insert(patch); check(r);
      if (input.status === 'sent') check(await db.rpc('move_deal_stage', { p_deal_id: input.deal_id, p_stage_key: 'demo' }));
    } else if (input.action === 'check_item') check(await db.from('checklist_items').update({ done_at: input.done ? new Date().toISOString() : null }).eq('id', input.id));
    else if (input.action === 'update_project') {
      const { action: _a, id: projectId, ...patch } = input;
      if (patch.stage_key === 'launched') throw new HttpError(400, 'Use Launch project to start hosting and local SEO tasks.');
      check(await db.from('projects').update({ ...patch, ...(patch.feature_permission ? { feature_permission_at: new Date().toISOString() } : {}) }).eq('id', projectId));
    } else if (input.action === 'launch_project') check(await db.rpc('launch_project', { p_project_id: input.id, p_site_url: input.site_url }));
    else if (input.action === 'subscription') check(await db.from('subscriptions').update({ status: input.status, status_reason: input.reason, cancelled_on: input.status === 'cancelled' ? new Date().toISOString().slice(0, 10) : null }).eq('id', input.id));
    else if (input.action === 'create_invoice') { const { action: _a, ...invoice } = input; const r = await db.rpc('create_invoice', { p_input: invoice }); check(r); created = r.data; }
    else if (input.action === 'invoice_from_quote') {
      const r = await db.rpc('invoice_from_quote', { p_quote_id: input.quote_id, p_kind: input.kind }); check(r); created = r.data;
    } else if (input.action === 'payment') check(await db.rpc('record_payment', { p_invoice_id: input.invoice_id, p_amount: input.amount, p_received_on: input.received_on, p_method: input.method, p_reference: input.reference || null }));
    return Response.json({ data: await loadCommerce(session), created });
  } catch (error) { return apiError(error); }
}
