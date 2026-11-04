import { z } from 'zod';
import { apiError, HttpError, requireSameOrigin, requireSession } from '@/lib/server/auth';
import { ProviderError, takeOverChloe } from '@/lib/server/providers';

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const { db, profile } = await requireSession(['owner', 'staff']);
    if (!process.env.CHLOE_TAKEOVER_URL) throw new HttpError(404, 'Chloe takeover is not configured.');
    const input = z.object({ deal_id: z.uuid() }).strict().safeParse(await request.json());
    if (!input.success) throw new HttpError(400, 'Choose a deal.');
    const deal = await db.from('deals').select('id,contact_id').eq('id', input.data.deal_id).is('deleted_at', null).single();
    if (deal.error || !deal.data) throw new HttpError(404, 'Deal not found.');
    const contact = await db.from('contacts').select('phone_e164').eq('id', deal.data.contact_id).single();
    if (!contact.data?.phone_e164) throw new HttpError(400, 'This contact has no phone number.');
    await takeOverChloe(contact.data.phone_e164);
    const updated = await db.from('deals').update({ chloe_status: 'human' }).eq('id', deal.data.id);
    if (updated.error) throw new HttpError(500, 'Chloe accepted the takeover but the CRM status could not be updated. Refresh before trying again.');
    await db.from('activities').insert({ deal_id: deal.data.id, contact_id: deal.data.contact_id, created_by: profile.id, type: 'chloe_status', body: 'Troy took over the conversation.', meta: { status: 'human' } });
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof ProviderError) return Response.json({ error: error.message }, { status: 502 });
    if (error instanceof SyntaxError) return Response.json({ error: 'Invalid JSON.' }, { status: 400 });
    return apiError(error);
  }
}
