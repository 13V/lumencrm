import { requireSession, apiError, HttpError } from '@/lib/server/auth';
import { normalizePhone } from '@/lib/domain/phone';
export async function GET(request: Request) {
  try {
    const { db, profile } = await requireSession(); const q = (new URL(request.url).searchParams.get('q') || '').trim();
    if (q.length < 2 || q.length > 200) return Response.json({ data: { deals: [], contacts: [], businesses: [], quotes: [], invoices: [] }, results: [] });
    const pattern = `%${q.replace(/[\\%_]/g, value => `\\${value}`)}%`, digits = q.replace(/\D/g, '');
    const [first, last, email, phone, businesses, title, ad, metaAd, quotes, invoices] = await Promise.all([
      db.from('contacts').select('*').ilike('first_name', pattern).is('deleted_at', null).limit(30),
      db.from('contacts').select('*').ilike('last_name', pattern).is('deleted_at', null).limit(30),
      db.from('contacts').select('*').ilike('email', pattern).is('deleted_at', null).limit(30),
      digits.length >= 3 ? db.from('contacts').select('*').ilike('phone_e164', `%${normalizePhone(q) || digits}%`).is('deleted_at', null).limit(30) : Promise.resolve({ data: [], error: null }),
      db.from('businesses').select('*').ilike('name', pattern).is('deleted_at', null).limit(30),
      db.from('deals').select('*').ilike('title', pattern).is('deleted_at', null).limit(30),
      db.from('attribution').select('deal_id').ilike('utm_content', pattern).limit(30), db.from('attribution').select('deal_id').ilike('meta_ad_name', pattern).limit(30),
      profile.role !== 'staff' ? db.from('quotes').select('id,number,status,deal_id').ilike('number', pattern).is('deleted_at', null).limit(20) : Promise.resolve({ data: [], error: null }),
      profile.role !== 'staff' ? db.from('invoices').select('id,number,status').ilike('number', pattern).is('deleted_at', null).limit(20) : Promise.resolve({ data: [], error: null }),
    ]);
    if ([first, last, email, phone, businesses, title, ad, metaAd, quotes, invoices].some(r => r.error)) throw new HttpError(503, 'Search could not be completed.');
    const contactIds = [...new Set([...first.data!, ...last.data!, ...email.data!, ...phone.data!].map(c => c.id))]; const businessIds = businesses.data!.map(b => b.id); const dealIds = [...ad.data!, ...metaAd.data!].map(a => a.deal_id);
    const related = await Promise.all([
      contactIds.length ? db.from('deals').select('*').in('contact_id', contactIds).is('deleted_at', null).limit(50) : Promise.resolve({ data: [], error: null }),
      businessIds.length ? db.from('deals').select('*').in('business_id', businessIds).is('deleted_at', null).limit(50) : Promise.resolve({ data: [], error: null }),
      dealIds.length ? db.from('deals').select('*').in('id', dealIds).is('deleted_at', null).limit(50) : Promise.resolve({ data: [], error: null }),
    ]);
    if (related.some(r => r.error)) throw new HttpError(503, 'Search could not be completed.');
    const deals = [...new Map([...title.data!, ...related.flatMap(r => r.data || [])].map(d => [d.id, d])).values()].slice(0, 50);
    const linkedContacts = deals.map(d => d.contact_id), linkedBusinesses = deals.map(d => d.business_id).filter(Boolean);
    const [contacts, businessRows] = await Promise.all([linkedContacts.length ? db.from('contacts').select('*').in('id', linkedContacts) : Promise.resolve({ data: [] }), linkedBusinesses.length ? db.from('businesses').select('*').in('id', linkedBusinesses) : Promise.resolve({ data: [] })]);
    const results = [...deals.map(d => { const c = contacts.data?.find(c => c.id === d.contact_id), b = businessRows.data?.find(b => b.id === d.business_id); return { id: d.id, type: 'deal', title: c ? `${c.first_name} ${c.last_name}`.trim() : d.title, subtitle: b?.name || d.title, href: `/leads/${d.id}` }; }), ...quotes.data!.map(q => ({ id: q.id, type: 'quote', title: q.number, subtitle: q.status, href: `/quotes?selected=${q.id}` })), ...invoices.data!.map(i => ({ id: i.id, type: 'invoice', title: i.number, subtitle: i.status, href: `/invoices?selected=${i.id}` }))];
    return Response.json({ data: { deals, contacts: contacts.data || [], businesses: businessRows.data || [], quotes: quotes.data, invoices: invoices.data }, results });
  } catch (error) { return apiError(error); }
}
