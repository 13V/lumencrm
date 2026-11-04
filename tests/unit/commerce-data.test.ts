import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({ role: 'owner', rows: {} as Record<string, Record<string, unknown>[]>, calls: [] as string[] }));
vi.mock('@/lib/server/auth', () => {
  class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
  function from(table: string) {
    state.calls.push(table);
    const filters: ((row: Record<string, unknown>) => boolean)[] = [];
    let size = 1000;
    const query = {
      select: () => query, order: () => query,
      limit: (n: number) => { size = Math.min(n, 1000); return query; },
      is: (field: string, value: unknown) => { filters.push(row => row[field] === value); return query; },
      in: (field: string, ids: unknown[]) => { filters.push(row => ids.includes(row[field])); return query; },
      gt: (field: string, value: string) => { filters.push(row => String(row[field]) > value); return query; },
      then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: (state.rows[table] || []).filter(row => filters.every(f => f(row))).sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, size), error: null }).then(resolve),
    };
    return query;
  }
  return { HttpError, requireSession: async () => ({ db: { from }, profile: { id: 'owner', role: state.role } }) };
});
import { loadCommerce } from '@/lib/server/commerce';

const row = (id: string, fields: Record<string, unknown> = {}) => ({ id, created_at: '2026-01-01T00:00:00Z', deleted_at: null, ...fields });
const many = (prefix: string, count: number, fields: Record<string, unknown> = {}) => Array.from({ length: count }, (_, i) => row(prefix + String(i).padStart(6, '0'), fields));

describe('complete commerce history', () => {
  beforeEach(() => { state.role = 'owner'; state.rows = {}; state.calls = []; });
  it('keeps older invoices, payments and hosting with their historical contact names', async () => {
    state.rows.invoices = many('i', 1201, { contact_id: 'old-contact', business_id: 'old-business', deal_id: 'old-deal', status: 'sent' });
    state.rows.payments = many('p', 1201, { invoice_id: 'i001200', amount: 1 });
    state.rows.subscriptions = many('s', 601, { business_id: 'old-business', status: 'active' });
    state.rows.deals = [row('old-deal', { contact_id: 'old-contact', business_id: 'old-business' })];
    state.rows.contacts = [row('old-contact', { first_name: 'Fictional', business_id: 'old-business' })];
    state.rows.businesses = [row('old-business', { name: 'Example business' })];
    const result = await loadCommerce();
    expect(result.invoices).toHaveLength(1201); expect(result.payments).toHaveLength(1201); expect(result.subscriptions).toHaveLength(601);
    expect(result.invoices.some(invoice => invoice.id === 'i001200')).toBe(true);
    expect(result.related?.contacts[0].first_name).toBe('Fictional');
    expect(result.related?.businesses[0].name).toBe('Example business');
  });
  it('scopes deep deal links and loads every checklist, item and payment', async () => {
    state.rows.deals = [row('wanted', { business_id: 'business' }), row('other')];
    state.rows.projects = [row('project', { deal_id: 'wanted' })];
    state.rows.quotes = [row('quote', { deal_id: 'wanted' }), row('other-quote', { deal_id: 'other' })];
    state.rows.invoices = [row('invoice', { deal_id: null, project_id: 'project' }), row('other-invoice', { deal_id: 'other' })];
    state.rows.checklist_items = many('check', 501, { project_id: 'project' });
    state.rows.quote_items = [...many('item', 501, { quote_id: 'quote' }), row('other-item', { quote_id: 'other-quote' })];
    state.rows.invoice_items = many('invoice-item', 501, { invoice_id: 'invoice' });
    state.rows.payments = many('payment', 501, { invoice_id: 'invoice' });
    const result = await loadCommerce(undefined, 'wanted');
    expect(result.quotes.map(quote => quote.id)).toEqual(['quote']);
    expect(result.invoices.map(invoice => invoice.id)).toEqual(['invoice']);
    for (const key of ['checklist_items', 'quote_items', 'invoice_items', 'payments'] as const) expect(result[key]).toHaveLength(501);
  });
  it('finds the newest Chloe reply beyond the first response page, without returning message content', async () => {
    state.rows.quotes = [row('quote', { deal_id: 'deal' })];
    state.rows.activities = many('a', 601, { deal_id: 'deal', type: 'sms_in', occurred_at: '2026-01-01T00:00:00Z', body: 'Private text' });
    state.rows.activities.push(row('z', { deal_id: 'deal', type: 'chloe_in', occurred_at: '2026-11-04T00:00:00Z', body: 'Private reply', meta: { text: 'Private' } }));
    const result = await loadCommerce();
    expect(result.related?.activities).toHaveLength(1);
    expect(result.related?.activities[0]).toMatchObject({ id: 'z', type: 'chloe_in', body: null, meta: {} });
  });
  it('never queries financial tables for staff', async () => {
    state.role = 'staff'; state.rows.deals = [row('deal')];
    const result = await loadCommerce(undefined, 'deal');
    expect(result.quotes).toEqual([]); expect(result.invoices).toEqual([]); expect(result.subscriptions).toEqual([]);
    expect(state.calls.some(table => ['quotes', 'invoices', 'subscriptions', 'payments', 'quote_items', 'invoice_items'].includes(table))).toBe(false);
  });
  it('fails explicitly rather than returning a partial history above its safety limit', async () => {
    state.rows.invoices = many('i', 50001);
    await expect(loadCommerce()).rejects.toMatchObject({ status: 413 });
  });
});
