import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { requireSession, HttpError } from './auth';
import { invoicePdf, type InvoiceDocument } from '@/lib/domain/invoice-pdf';
export async function loadInvoiceDocument(id: string, session?: Awaited<ReturnType<typeof requireSession>>): Promise<InvoiceDocument> {
  const { db, profile } = session || await requireSession(['owner', 'viewer']);
  const { data: inv, error } = await db.from('invoices').select('*').eq('id', id).is('deleted_at', null).single();
  if (error || !inv) throw new HttpError(404, 'Invoice not found.');
  const [items, payments, business, contact, settings, deal] = await Promise.all([
    db.from('invoice_items').select('*').eq('invoice_id', id).is('deleted_at', null).order('sort'),
    db.from('payments').select('amount').eq('invoice_id', id).is('deleted_at', null),
    inv.business_id ? db.from('businesses').select('name').eq('id', inv.business_id).single() : Promise.resolve({ data: null }),
    inv.contact_id ? db.from('contacts').select('first_name,last_name').eq('id', inv.contact_id).single() : Promise.resolve({ data: null }),
    profile.role === 'owner' ? db.from('settings').select('config').single() : Promise.resolve({ data: null }),
    inv.deal_id ? db.from('deals').select('value_monthly').eq('id', inv.deal_id).single() : Promise.resolve({ data: null }),
  ]);
  if (items.error || payments.error) throw new HttpError(503, 'Invoice details could not be loaded.');
  return { number: inv.number, issued_on: inv.issued_on, due_on: inv.due_on, status: inv.status, business_name: business.data?.name || '', contact_name: [contact.data?.first_name, contact.data?.last_name].filter(Boolean).join(' '), lumen: inv.billing_snapshot?.business || { trading_name: 'Lumen adl' }, items: items.data || [], subtotal: Number(inv.subtotal), gst: Number(inv.gst), total: Number(inv.total), paid: (payments.data || []).reduce((sum, p) => sum + Number(p.amount), 0), gst_wording: inv.gst_wording || '', notes: inv.notes, monthly_price: deal.data?.value_monthly || null, bank: profile.role === 'owner' ? settings.data?.config?.invoices?.bank_details : undefined };
}
export async function renderInvoice(document: InvoiceDocument) {
  return invoicePdf(document, await readFile(path.join(process.cwd(), 'public/fonts/inter-regular.ttf')));
}
