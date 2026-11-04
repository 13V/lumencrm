import { z } from 'zod';
import { loadInvoiceDocument, renderInvoice } from '@/lib/server/invoice';
import { apiError } from '@/lib/server/auth';
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { const { id } = await params; if (!z.uuid().safeParse(id).success) return new Response('Not found', { status: 404 }); const doc = await loadInvoiceDocument(id); const bytes = await renderInvoice(doc); return new Response(Buffer.from(bytes), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${doc.number.replace(/[^A-Za-z0-9_-]/g, '')}.pdf"`, 'Cache-Control': 'private, no-store' } }); } catch (error) { return apiError(error); }
}
