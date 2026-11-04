import { it, expect } from 'vitest';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { invoicePdf, type InvoiceDocument } from '@/lib/domain/invoice-pdf';
it('renders a real Unicode invoice and paginates long line descriptions', async () => {
  const doc: InvoiceDocument = { number: 'LUM-0001', issued_on: '2026-11-04', due_on: '2026-11-18', status: 'part_paid', business_name: 'Fictional Spark Electrical', contact_name: 'Alex Example', lumen: { trading_name: 'Lumen adl', legal_name: 'Troy Watson', email: 'studio@example.com', address: 'Adelaide, South Australia' }, items: [{ description: 'Website build', qty: 1, unit_price: 2200 }, { description: 'Google Business Profile and first three months of local SEO', qty: 1, unit_price: 0, included: true }], subtotal: 2200, gst: 0, total: 2200, paid: 1100, gst_wording: 'No GST was charged.', notes: 'Please use the invoice number as your payment reference.', monthly_price: 49, bank: { account_name: 'Fictional preview account', bsb: '000-000', account_number: '00000000' } };
  const font = await readFile('public/fonts/inter-regular.ttf');
  const bytes = await invoicePdf(doc, font); const parsed = await PDFDocument.load(bytes);
  expect(parsed.getPageCount()).toBe(1); expect(parsed.getTitle()).toContain('LUM-0001');
  await mkdir('test-results/pdf', { recursive: true }); await writeFile('test-results/pdf/invoice-proof.pdf', bytes);
  const long = await invoicePdf({ ...doc, contact_name: 'Zoë Example', items: Array.from({ length: 40 }, (_, i) => ({ description: `Line ${i + 1} · ${'A detailed project item with wrapping. '.repeat(5)}`, qty: 1, unit_price: 55 })) }, font);
  expect((await PDFDocument.load(long)).getPageCount()).toBeGreaterThan(2);
}, 30000);
