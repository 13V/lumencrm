import { z } from 'zod';
import { requireSameOrigin, requireSession, apiError, HttpError } from '@/lib/server/auth';
import { loadInvoiceDocument, renderInvoice } from '@/lib/server/invoice';
import { sendEmail, emailReady, ProviderError } from '@/lib/server/providers';
import { formatMoney } from '@/lib/domain/money';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request); const session = await requireSession(['owner']); const { db } = session; const { id } = await params;
    const parsed = z.object({ request_id: z.uuid() }).safeParse(await request.json());
    if (!parsed.success || !z.uuid().safeParse(id).success) throw new HttpError(400, 'Choose a valid invoice and send request.');
    if (!emailReady()) throw new HttpError(503, 'Configure Resend and the sender address before emailing invoices.');
    const doc = await loadInvoiceDocument(id, session);
    if (doc.status === 'void' || doc.status === 'paid') throw new HttpError(400, 'This invoice is void or already paid.');
    const subject = `Invoice ${doc.number} · Lumen adl`;
    const body = `Hi ${doc.contact_name || doc.business_name},\n\nInvoice ${doc.number} is attached. The total is ${formatMoney(doc.total)}, due on ${doc.due_on}.${doc.monthly_price ? ` Ongoing hosting and maintenance is ${formatMoney(doc.monthly_price)}/month, billed separately.` : ''}\n\nIf anything is unclear, reply here.\n\nThanks,\nTroy, Lumen adl\n\nTo stop receiving emails, reply unsubscribe.`;
    // Build the document before reserving a send, so a rendering error is safe to retry.
    const bytes = await renderInvoice(doc);
    const reservation = await db.rpc('prepare_invoice_message', { p_invoice_id: id, p_request_id: parsed.data.request_id, p_body: body, p_subject: subject });
    if (reservation.error || !reservation.data) throw new HttpError(409, 'Check the invoice contact, email consent and opt-out before sending.');
    const prepared = reservation.data;
    if (prepared.duplicate) return Response.json({ ok: true, duplicate: true, message: 'This send was already requested. Check the timeline before trying again.' });
    try {
      const delivery = await sendEmail(prepared.email, subject, body, parsed.data.request_id, [{ filename: `${doc.number}.pdf`, content: Buffer.from(bytes).toString('base64') }]);
      await db.rpc('finalise_message', { p_activity_id: prepared.activity_id, p_status: delivery.status, p_provider_id: delivery.id });
      const result = await db.from('invoices').update({ status: doc.status === 'draft' ? 'sent' : doc.status, sent_at: new Date().toISOString() }).eq('id', id).eq('status', doc.status);
      if (result.error) return Response.json({ ok: true, message: 'Email queued. The invoice status needs review.', status: 'queued' });
      const link = await db.from('invoices').select('contact_id,deal_id').eq('id', id).single();
      await db.from('activities').insert({ type: 'invoice_sent', contact_id: link.data?.contact_id, deal_id: link.data?.deal_id, created_by: session.profile.id, body: `Invoice ${doc.number} queued for email`, meta: { invoice_id: id } });
      return Response.json({ ok: true, status: 'queued' });
    } catch (error) {
      await db.rpc('finalise_message', { p_activity_id: prepared.activity_id, p_status: error instanceof ProviderError && error.uncertain ? 'unknown' : 'failed', p_provider_id: null });
      throw new HttpError(502, error instanceof ProviderError ? error.message : 'Email could not be confirmed. Check the provider log before sending again.');
    }
  } catch (error) { return apiError(error); }
}
