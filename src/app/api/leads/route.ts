import { requireSession, apiError, HttpError } from '@/lib/server/auth';
export async function GET(request: Request) {
  try {
    const { db } = await requireSession(); const url = new URL(request.url), offset = Math.max(0, Math.min(1000000, Number(url.searchParams.get('offset')) || 0)), limit = Math.max(1, Math.min(250, Number(url.searchParams.get('limit')) || 250));
    const { data: deals, error, count } = await db.from('deals').select('*', { count: 'exact' }).is('deleted_at', null).order('created_at', { ascending: false }).order('id').range(offset, offset + limit - 1);
    if (error) throw new HttpError(503, 'Leads could not be loaded.');
    const contactIds = [...new Set(deals.map(d => d.contact_id))], businessIds = [...new Set(deals.map(d => d.business_id).filter(Boolean))], ids = deals.map(d => d.id);
    const [contacts, businesses, attribution] = await Promise.all([contactIds.length ? db.from('contacts').select('*').in('id', contactIds) : Promise.resolve({ data: [] }), businessIds.length ? db.from('businesses').select('*').in('id', businessIds) : Promise.resolve({ data: [] }), ids.length ? db.from('attribution').select('*').in('deal_id', ids) : Promise.resolve({ data: [] })]);
    return Response.json({ deals, contacts: contacts.data || [], businesses: businesses.data || [], attribution: attribution.data || [], total: count, has_more: offset + deals.length < (count || 0), next_offset: offset + deals.length });
  } catch (error) { return apiError(error); }
}
