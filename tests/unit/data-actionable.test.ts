import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/server/auth', () => { class HttpError extends Error { constructor(public status: number, message: string) { super(message); } } return { HttpError, requireSession: vi.fn() }; });
import { loadCrm } from '@/lib/server/data';

type Row = Record<string, unknown>;
function fixture(extraOpen = 0) {
  const recent = Array.from({ length: 300 }, (_, i) => ({ id: `recent-${String(i).padStart(3, '0')}`, created_at: `2026-11-${String(i % 4 + 1).padStart(2, '0')}T00:00:00Z`, deleted_at: null }));
  const deal = (id: string, outcome = 'open'): Row => ({ id, contact_id: `contact-${id}`, business_id: `business-${id}`, outcome, stage_key: 'new', created_at: '2024-01-01T00:00:00Z', deleted_at: null });
  const oldDeals = [deal('old-open'), deal('old-closed-task', 'lost'), deal('old-closed-call', 'won'), ...Array.from({ length: extraOpen }, (_, i) => deal(`old-open-${String(i).padStart(4, '0')}`))];
  const tables: Record<string, Row[]> = {
    contacts: [...recent, ...oldDeals.map(d => ({ id: d.contact_id, created_at: '2024-01-01T00:00:00Z', deleted_at: null }))],
    businesses: [...recent, ...oldDeals.map(d => ({ id: d.business_id, created_at: '2024-01-01T00:00:00Z', deleted_at: null }))],
    deals: [...recent.map(row => ({ ...row, contact_id: row.id, business_id: row.id, outcome: 'lost' })), ...oldDeals],
    tasks: [...recent.map(row => ({ ...row, done_at: row.created_at })), { id: 'old-overdue', deal_id: 'old-closed-task', contact_id: 'contact-old-closed-task', created_at: '2024-01-01T00:00:00Z', due_at: '2024-02-01T00:00:00Z', done_at: null, deleted_at: null }],
    appointments: [...recent.map(row => ({ ...row, status: 'done' })), { id: 'old-booked', deal_id: 'old-closed-call', contact_id: 'contact-old-closed-call', created_at: '2024-01-01T00:00:00Z', starts_at: '2026-11-05T00:00:00Z', status: 'booked', deleted_at: null }],
    attribution: oldDeals.map(row => ({ id: `attr-${row.id}`, deal_id: row.id, created_at: row.created_at, utm_campaign: 'Fictional old campaign' })),
    activities: [], profiles: [],
  };
  const batches: number[] = [], pageStarts: number[] = [];
  const db = {
    rpc: vi.fn().mockResolvedValue({ data: { speed_to_lead_minutes: 5 }, error: null }),
    from: (table: string) => {
      const predicates: ((row: Row) => boolean)[] = [];
      let from = 0, to = Infinity, limit = Infinity, sort = '', descending = false;
      const result = () => {
        let rows = (tables[table] || []).filter(row => predicates.every(predicate => predicate(row)));
        if (sort) rows = [...rows].sort((a, b) => String(a[sort]).localeCompare(String(b[sort])) * (descending ? -1 : 1));
        return { data: rows.slice(from, Math.min(to + 1, from + limit)), error: null };
      };
      const query = {
        select: () => query,
        limit: (value: number) => { limit = value; return query; },
        is: (key: string, value: unknown) => { predicates.push(row => (row[key] ?? null) === value); return query; },
        eq: (key: string, value: unknown) => { predicates.push(row => row[key] === value); return query; },
        in: (key: string, values: unknown[]) => { batches.push(values.length); predicates.push(row => values.includes(row[key])); return query; },
        order: (key: string, options?: { ascending?: boolean }) => { sort = key; descending = options?.ascending === false; return query; },
        range: (start: number, end: number) => { from = start; to = end; pageStarts.push(start); return query; },
        maybeSingle: async () => ({ ...result(), data: result().data[0] ?? null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return query;
    },
  };
  const session = { db, user: { id: 'owner', email: 'owner@example.com' }, profile: { id: 'profile', name: 'Example Owner', role: 'owner' } } as unknown as NonNullable<Parameters<typeof loadCrm>[0]>;
  return { session, db, batches, pageStarts };
}

describe('actionable CRM records beyond the first page', () => {
  it('includes ancient open leads, overdue work, booked calls and their older linked people', async () => {
    const { session } = fixture();
    const data = await loadCrm(session);
    expect(data.deals.map(row => row.id)).toEqual(expect.arrayContaining(['old-open', 'old-closed-task', 'old-closed-call']));
    expect(data.tasks.some(row => row.id === 'old-overdue')).toBe(true);
    expect(data.appointments.some(row => row.id === 'old-booked')).toBe(true);
    expect(data.contacts.some(row => row.id === 'contact-old-closed-task')).toBe(true);
    expect(data.businesses.some(row => row.id === 'business-old-closed-call')).toBe(true);
    expect(data.attribution.some(row => row.deal_id === 'old-open')).toBe(true);
    expect(new Set(data.deals.map(row => row.id)).size).toBe(data.deals.length);
  });
  it('continues through the actionable page boundary and batches related-record queries', async () => {
    const { session, pageStarts, batches } = fixture(501);
    const data = await loadCrm(session);
    expect(data.deals.filter(row => row.outcome === 'open')).toHaveLength(502);
    expect(pageStarts).toContain(500);
    expect(Math.max(...batches)).toBeLessThanOrEqual(100);
    expect(data.contacts.some(row => row.id === 'contact-old-open-0500')).toBe(true);
  });
  it('does not quietly replace a failed configuration read with default business rules', async () => {
    const { session, db } = fixture(); db.rpc.mockResolvedValue({ data: null, error: { message: 'Unavailable' } });
    await expect(loadCrm(session)).rejects.toMatchObject({ status: 503 });
  });
});
