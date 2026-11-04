import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { deliverCapi, queueCapi } from '@/lib/server/jobs/meta';
import type { JobContext } from '@/lib/server/jobs/shared';
describe('CAPI disabled switch', () => {
  it('does not queue or send when disabled, including already queued work', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const rpc = vi.fn();
    const query = { eq: () => ({ single: async () => ({ data: { config: { capi: { enabled: false } } }, error: null }) }) };
    const context = { settings: { capi: { enabled: false } }, db: { rpc, from: () => ({ select: () => query }) } } as unknown as JobContext;
    expect(await queueCapi(context)).toBe(0); expect(await deliverCapi(context)).toBe(0);
    expect(rpc).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled(); vi.unstubAllGlobals();
  });
});
