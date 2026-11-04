import { redirect } from 'next/navigation';
import { loadInvoiceDocument } from '@/lib/server/invoice';
import { HttpError } from '@/lib/server/auth';
import { formatMoney } from '@/lib/domain/money';
import { PrintButton } from './ui';
import '@/app/q/quote.css';
export const dynamic = 'force-dynamic';
export default async function InvoicePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; let doc;
  try { doc = await loadInvoiceDocument(id); } catch (error) { if (error instanceof HttpError && error.status === 428) redirect('/auth/mfa'); redirect('/login'); }
  return <main className="public-document"><header className="spread"><div className="brand"><span className="brand-name">Lumen</span><span className="brand-adl">adl</span></div><PrintButton /></header><h1>{doc.gst > 0 ? 'Tax invoice' : 'Invoice'} {doc.number}</h1><p>For {doc.business_name || doc.contact_name}<br />Issued {doc.issued_on} · Due {doc.due_on}</p><div className="card">{doc.items.map((line, i) => <div key={i} className="quote-line spread"><span>{line.description} × {line.qty}</span><strong>{line.included ? 'Included' : formatMoney(line.qty * line.unit_price)}</strong></div>)}{doc.monthly_price && <p className="muted">Hosting and maintenance: {formatMoney(doc.monthly_price)}/month, billed separately.</p>}<div className="detail-section"><p>Subtotal {formatMoney(doc.subtotal)}{doc.gst > 0 ? ` · GST ${formatMoney(doc.gst)}` : ''}</p><h2>Total {formatMoney(doc.total)}</h2><p>{doc.gst_wording}</p><p>Paid {formatMoney(doc.paid)} · Balance {formatMoney(Math.max(0, doc.total - doc.paid))}</p></div></div>{doc.bank && <section className="card"><h2>Payment details</h2><p>{doc.bank.account_name}<br />BSB {doc.bank.bsb} · Account {doc.bank.account_number}<br />Reference {doc.number}</p></section>}{doc.notes && <p>{doc.notes}</p>}</main>;
}
