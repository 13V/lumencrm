import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

export interface InvoiceDocument {
  number: string; issued_on: string; due_on: string; status: string;
  business_name: string; contact_name: string; lumen: { trading_name: string; legal_name?: string; abn?: string; email?: string; phone?: string; address?: string };
  items: { description: string; qty: number; unit_price: number; included?: boolean }[];
  subtotal: number; gst: number; total: number; paid: number; gst_wording: string; notes: string | null; monthly_price?: number | null;
  bank?: { account_name?: string; bsb?: string; account_number?: string };
}
const money = (value: number) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(value);
const date = (value: string) => new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Australia/Adelaide' }).format(new Date(`${value}T12:00:00Z`));
/** Layout is paginated before drawing, including unusually long client text. */
export async function invoicePdf(invoice: InvoiceDocument, fontBytes: Uint8Array): Promise<Uint8Array> {
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  pdf.setTitle(`${invoice.number} · Lumen adl`); pdf.setAuthor('Lumen adl'); pdf.setCreator('Lumen CRM');
  const width = 595.28, height = 841.89, margin = 44, inner = width - margin * 2;
  let page = pdf.addPage([width, height]), y = height - margin;
  const ink = rgb(17 / 255, 17 / 255, 16 / 255), muted = rgb(.37, .37, .36), line = rgb(.88, .88, .86);
  function nextPage() { page = pdf.addPage([width, height]); y = height - margin; }
  function room(h: number) { if (y - h < 62) nextPage(); }
  function wrap(value: string, max: number, size = 10): string[] {
    const lines: string[] = [];
    for (const paragraph of value.replace(/\r/g, '').split('\n')) {
      let current = '';
      for (const word of paragraph.split(/\s+/)) {
        if (font.widthOfTextAtSize(`${current}${current ? ' ' : ''}${word}`, size) <= max) current += `${current ? ' ' : ''}${word}`;
        else { if (current) lines.push(current); current = ''; for (const char of word) { if (font.widthOfTextAtSize(current + char, size) > max) { lines.push(current); current = ''; } current += char; } }
      }
      lines.push(current);
    }
    return lines;
  }
  function text(value: string, size = 10, colour = ink, gap = 5) {
    for (const item of wrap(value, inner, size)) { room(size + gap); y -= size; page.drawText(item, { x: margin, y, size, font, color: colour }); y -= gap; }
  }
  function rule() { room(18); page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness: .6, color: line }); y -= 18; }
  text('Lumen adl', 25, ink, 12); text(invoice.gst > 0 ? 'TAX INVOICE' : 'INVOICE', 10, muted); text(invoice.number, 20, ink, 12);
  text(`${invoice.lumen.legal_name || invoice.lumen.trading_name}${invoice.lumen.abn ? ` · ABN ${invoice.lumen.abn}` : ''}`, 10, muted);
  for (const value of [invoice.lumen.address, [invoice.lumen.email, invoice.lumen.phone].filter(Boolean).join(' · ')]) if (value) text(value, 9, muted);
  y -= 16; rule();
  text(`For ${invoice.business_name || invoice.contact_name}`, 13); if (invoice.business_name && invoice.contact_name) text(invoice.contact_name, 10, muted);
  text(`Issued ${date(invoice.issued_on)}     Due ${date(invoice.due_on)}`, 10, muted); y -= 14;
  function tableHeader() { room(34); page.drawText('DESCRIPTION', { x: margin, y, size: 9, font, color: muted }); page.drawText('QTY', { x: 390, y, size: 9, font, color: muted }); page.drawText('AMOUNT', { x: 476, y, size: 9, font, color: muted }); y -= 16; rule(); }
  tableHeader();
  for (const item of invoice.items) {
    const description = wrap(item.description, 322, 10);
    if (y - description.length * 15 - 18 < 62) { nextPage(); tableHeader(); }
    for (let i = 0; i < description.length; i++) {
      if (y < 78) { nextPage(); tableHeader(); }
      page.drawText(description[i], { x: margin, y, size: 10, font, color: ink });
      if (i === 0) {
        page.drawText(String(item.qty), { x: 390, y, size: 10, font, color: muted });
        const amount = item.included ? 'Included' : money(Math.round(item.qty * item.unit_price * 100) / 100);
        page.drawText(amount, { x: width - margin - font.widthOfTextAtSize(amount, 10), y, size: 10, font, color: ink });
      }
      y -= 15;
    }
    y -= 10; rule();
  }
  if (invoice.monthly_price != null && invoice.monthly_price > 0) text(`Ongoing hosting and maintenance: ${money(invoice.monthly_price)}/month, billed separately.`, 10, muted);
  y -= 10; room(130);
  text(`Subtotal ${money(invoice.subtotal)}`, 11); if (invoice.gst > 0) text(`GST ${money(invoice.gst)}`, 11);
  text(`Total ${money(invoice.total)}`, 16, ink, 8); text(invoice.gst_wording, 9, muted);
  if (invoice.paid > 0) { text(`Payments received ${money(invoice.paid)}`, 10); text(`Balance due ${money(Math.max(0, invoice.total - invoice.paid))}`, 13); }
  if (invoice.bank && Object.values(invoice.bank).some(Boolean)) { y -= 18; room(90); text('Payment details', 12); for (const value of [invoice.bank.account_name, invoice.bank.bsb ? `BSB ${invoice.bank.bsb}` : '', invoice.bank.account_number ? `Account ${invoice.bank.account_number}` : '', `Reference ${invoice.number}`]) if (value) text(value, 10); }
  if (invoice.notes) { y -= 18; text('Notes', 12); text(invoice.notes, 10, muted); }
  const pages = pdf.getPages(); pages.forEach((p, i) => p.drawText(`${invoice.number} · Lumen adl                                         ${i + 1} / ${pages.length}`, { x: margin, y: 30, size: 8, font, color: muted }));
  return pdf.save();
}
