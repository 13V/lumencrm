import 'server-only';
import { requireSession, HttpError } from './auth';
import { EMPTY_COMMERCE, type CommerceData } from '@/lib/commerce-types';

type Session = Awaited<ReturnType<typeof requireSession>>;
type Row = Record<string, unknown>;
type Filter = { field: string; ids: string[] };
const commerceTables = Object.keys(EMPTY_COMMERCE);
const staffTables = new Set(['demos', 'products', 'projects', 'checklist_items']);

// Keyset pages stay below PostgREST's default 1,000-row response limit. Fail
// explicitly at the safety cap instead of quietly hiding old money owed.
async function collection(db: Session['db'], table: string, filter?: Filter, live = true, inbound = false): Promise<Row[]> {
  if (filter && !filter.ids.length) return [];
  const ids = filter ? [...new Set(filter.ids)] : null;
  const found = new Map<string, Row>();
  for (let offset = 0; offset < (ids?.length || 1); offset += 100) {
    let cursor: string | undefined;
    for (;;) {
      const columns = inbound ? 'id,deal_id,contact_id,created_by,type,occurred_at,created_at,updated_at,deleted_at,direction,outcome,duration_seconds' : '*';
      let query = db.from(table).select(columns).order('id', { ascending: true }).limit(500);
      if (live) query = query.is('deleted_at', null);
      if (ids && filter) query = query.in(filter.field, ids.slice(offset, offset + 100));
      if (inbound) query = query.in('type', ['sms_in', 'email_in', 'chloe_in']);
      if (cursor) query = query.gt('id', cursor);
      const result = await query;
      if (result.error) throw new HttpError(503, 'Delivery and billing records could not be loaded.');
      const rows = (result.data || []) as unknown as Row[];
      for (const row of rows) found.set(String(row.id), row);
      if (found.size > 50000) throw new HttpError(413, 'This workspace has more than 50,000 ' + table + ' records. Open a deal to load its records, or export the relevant date range.');
      if (rows.length < 500) break;
      cursor = String(rows.at(-1)!.id);
    }
  }
  return [...found.values()].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}
const links = (rows: Row[], field: string) => [...new Set(rows.map(row => row[field]).filter((value): value is string => typeof value === 'string' && !!value))];

export async function loadCommerce(session?: Session, dealId?: string): Promise<CommerceData> {
  const { db, profile } = session || await requireSession();
  const financial = profile.role !== 'staff';
  const records: Record<string, Row[]> = {};
  if (dealId) {
    const selected = await collection(db, 'deals', { field: 'id', ids: [dealId] });
    if (!selected.length) throw new HttpError(404, 'This deal could not be found.');
    const direct = financial ? ['demos', 'projects', 'quotes', 'invoices'] : ['demos', 'projects'];
    await Promise.all(direct.map(async table => { records[table] = await collection(db, table, { field: 'deal_id', ids: [dealId] }); }));
    records.products = await collection(db, 'products');
    records.checklist_items = await collection(db, 'checklist_items', { field: 'project_id', ids: links(records.projects, 'id') });
    if (financial) {
      const [projectInvoices, quoteInvoices] = await Promise.all([
        collection(db, 'invoices', { field: 'project_id', ids: links(records.projects, 'id') }),
        collection(db, 'invoices', { field: 'quote_id', ids: links(records.quotes, 'id') }),
      ]);
      records.invoices = [...new Map([...records.invoices, ...projectInvoices, ...quoteInvoices].map(row => [row.id, row])).values()];
      await Promise.all([
        collection(db, 'quote_items', { field: 'quote_id', ids: links(records.quotes, 'id') }).then(rows => { records.quote_items = rows; }),
        collection(db, 'invoice_items', { field: 'invoice_id', ids: links(records.invoices, 'id') }).then(rows => { records.invoice_items = rows; }),
        collection(db, 'payments', { field: 'invoice_id', ids: links(records.invoices, 'id') }).then(rows => { records.payments = rows; }),
        collection(db, 'subscriptions', { field: 'business_id', ids: links(selected, 'business_id') }).then(rows => { records.subscriptions = rows; }),
      ]);
    }
  } else {
    await Promise.all(commerceTables.filter(table => financial || staffTables.has(table)).map(async table => { records[table] = await collection(db, table); }));
  }

  const dealIds = links([...(records.demos || []), ...(records.projects || []), ...(records.quotes || []), ...(records.invoices || [])], 'deal_id');
  if (dealId) dealIds.push(dealId);
  const deals = await collection(db, 'deals', { field: 'id', ids: dealIds }, false);
  const contacts = await collection(db, 'contacts', { field: 'id', ids: links([...deals, ...(records.invoices || [])], 'contact_id') }, false);
  const businesses = await collection(db, 'businesses', { field: 'id', ids: links([...deals, ...contacts, ...(records.projects || []), ...(records.subscriptions || []), ...(records.invoices || [])], 'business_id') }, false);
  // A reply may precede the bounded general timeline. Only its newest timestamp
  // per quoted deal is needed to determine whether a viewed quote was answered.
  const inbound = financial ? await collection(db, 'activities', { field: 'deal_id', ids: links(records.quotes || [], 'deal_id') }, true, true) : [];
  const latest = new Map<string, Row>();
  for (const row of inbound) {
    const prior = latest.get(String(row.deal_id));
    if (!prior || String(row.occurred_at) > String(prior.occurred_at)) latest.set(String(row.deal_id), { ...row, body: null, meta: {} });
  }
  const result = { ...EMPTY_COMMERCE, ...records, related: { deals, contacts, businesses, activities: [...latest.values()] } } as unknown as CommerceData;
  // Leave headroom below Vercel's 4.5 MB response limit, including the Next.js
  // response wrapper. Large workspaces receive an explicit error, never a cut list.
  if (Buffer.byteLength(JSON.stringify(result)) > 4_000_000) throw new HttpError(413, 'These delivery and billing records exceed 4 MB. Open an individual deal or export a narrower date range.');
  return result;
}
