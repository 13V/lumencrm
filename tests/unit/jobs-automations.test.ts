import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const { notification } = vi.hoisted(() => ({ notification: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/server/jobs/shared', async (original) => ({
  ...await original<typeof import('@/lib/server/jobs/shared')>(),
  queueNotification: notification,
  runClaimed: async (_context: unknown, _key: string, _kind: string, work: () => Promise<number>) => ({ status: 'done', count: await work() }),
}));
import { entityAutomations } from '@/lib/server/jobs/automations';
import type { JobContext } from '@/lib/server/jobs/shared';

function context(records: { key: string; kind: string; entity_id: string }[]): JobContext {
  const jobs = { select: () => jobs, in: () => jobs, or: () => jobs, lte: () => jobs, order: () => jobs, limit: async () => ({ data: records, error: null }) };
  const quote = { select: () => quote, eq: () => quote, single: async () => ({ data: { deal_id: 'deal-1', status: 'accepted', deleted_at: null }, error: null }) };
  return { now: new Date('2026-11-04T00:00:00Z'), enabled: new Set(['quote_accepted']), db: { from: (table: string) => { if (table === 'job_runs') return jobs; if (table === 'quotes') return quote; throw new Error(`Unexpected table: ${table}`); } } } as unknown as JobContext;
}
describe('durable notification events', () => {
  beforeEach(() => notification.mockClear());
  it('reuses acceptance transaction key and links to the deal, not the quote', async () => {
    const ctx = context([{ key: 'quote_accepted:quote-1', kind: 'quote_accepted', entity_id: 'quote-1' }, { key: 'stage:deal-1:won', kind: 'stage_automation', entity_id: 'deal-1' }]);
    await entityAutomations(ctx);
    expect(notification).toHaveBeenCalledExactlyOnceWith(ctx, 'quote_accepted:quote-1', 'deal-1');
  });
  it('adds push for a handled reply without duplicating the ingest Telegram alert', async () => {
    const ctx = context([{ key: 'reply:hashed-event', kind: 'human_reply', entity_id: 'deal-1' }]);
    await entityAutomations(ctx);
    expect(notification).toHaveBeenCalledExactlyOnceWith(ctx, 'reply:hashed-event', 'deal-1', ['push']);
  });
});
