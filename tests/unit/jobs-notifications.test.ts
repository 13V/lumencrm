import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const mocks = vi.hoisted(() => ({ telegramReady: vi.fn(), pushReady: vi.fn(), sendTelegram: vi.fn().mockResolvedValue(undefined), deliverPush: vi.fn().mockResolvedValue('sent') }));
vi.mock('@/lib/server/providers', () => ({ telegramReady: mocks.telegramReady, sendTelegram: mocks.sendTelegram }));
vi.mock('@/lib/server/jobs/push', () => ({ pushReady: mocks.pushReady, deliverPush: mocks.deliverPush, ownerSubscriptions: async () => [{ id: 'device-1', endpoint: 'https://fcm.googleapis.com/fake', keys: {} }] }));
import { deliverNotifications } from '@/lib/server/jobs/notifications';
import type { JobContext } from '@/lib/server/jobs/shared';

type Notice = { id: string; event_key: string; entity_id: string | null; channel: string; status: string; error?: string };
function context(notices: Notice[]) {
  const rows = notices;
  const lead = { first_touch_at: '2026-11-04T00:00:00Z', outcome: 'open', deleted_at: null };
  const from = (table: string) => {
    let update: Record<string, unknown> | undefined, selected = false, cap = Infinity;
    const filters: ((row: Notice) => boolean)[] = [];
    const execute = () => {
      if (table === 'deals') return { data: lead, error: null };
      const matches = rows.filter((row) => filters.every((filter) => filter(row))).slice(0, cap);
      if (update) for (const row of matches) Object.assign(row, update);
      return { data: selected ? matches : null, error: null };
    };
    const query = {
      select: () => { selected = true; return query; },
      update: (value: Record<string, unknown>) => { update = value; return query; },
      in: (key: keyof Notice, values: unknown[]) => { filters.push((row) => values.includes(row[key])); return query; },
      eq: (key: keyof Notice, value: unknown) => { filters.push((row) => row[key] === value); return query; },
      like: (key: keyof Notice, value: string) => { filters.push((row) => String(row[key]).startsWith(value.replace('%', ''))); return query; },
      lt: () => { filters.push(() => false); return query; },
      order: () => query,
      limit: (value: number) => { cap = value; return query; },
      single: async () => execute(),
      maybeSingle: async () => { const result = execute(); return { ...result, data: Array.isArray(result.data) ? result.data[0] ?? null : result.data }; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(execute()).then(resolve),
    };
    return query;
  };
  return { context: { now: new Date('2026-11-04T02:00:00Z'), db: { from } } as unknown as JobContext, rows };
}
describe('notification queue delivery', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.telegramReady.mockReturnValue(true); mocks.pushReady.mockReturnValue(false); });
  it('does not let an unconfigured Telegram backlog starve configured web push', async () => {
    mocks.telegramReady.mockReturnValue(false); mocks.pushReady.mockReturnValue(true);
    const pending = Array.from({ length: 100 }, (_, index) => ({ id: `telegram-${index}`, event_key: `new_lead:${index}`, entity_id: null, channel: 'telegram', status: 'pending' }));
    pending.push({ id: 'push-1', event_key: 'new_lead:latest', entity_id: null, channel: 'push:device-1', status: 'pending' });
    const fixture = context(pending);
    expect(await deliverNotifications(fixture.context)).toBe(1);
    expect(mocks.sendTelegram).not.toHaveBeenCalled();
    expect(mocks.deliverPush).toHaveBeenCalledOnce();
    expect(fixture.rows.at(-1)?.status).toBe('sent');
  });
  it('skips old digests and speed nudges after the lead has been handled', async () => {
    const fixture = context([{ id: 'digest', event_key: 'digest:2026-11-03', entity_id: null, channel: 'telegram', status: 'pending' }, { id: 'speed', event_key: 'speed:lead-1', entity_id: 'lead-1', channel: 'telegram', status: 'pending' }]);
    expect(await deliverNotifications(fixture.context)).toBe(0);
    expect(mocks.sendTelegram).not.toHaveBeenCalled();
    expect(fixture.rows.map((row) => row.error)).toEqual(['digest_expired', 'lead_already_handled']);
  });
});
