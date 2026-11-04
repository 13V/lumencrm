import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), role: 'owner' }));
vi.mock('@/lib/server/auth', () => {
  class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
  const query = { select: () => query, eq: () => query, single: async () => ({ data: { stage_key: 'new' }, error: null }) };
  return { HttpError, requireSameOrigin: () => undefined, requireSession: async (roles: string[]) => { if (!roles.includes(mocks.role)) throw new HttpError(403, 'Forbidden'); return { db: { from: () => query, rpc: mocks.rpc }, profile: { id: 'owner', role: mocks.role } }; }, apiError: (error: unknown) => Response.json({ error: 'Blocked' }, { status: error instanceof HttpError ? error.status : 500 }) };
});
vi.mock('@/lib/server/data', () => ({ loadCrm: async () => ({ deals: [] }) }));
import { POST } from '@/app/api/crm/route';
const id = '00000000-0000-4000-8000-000000000001';
const request = (stage_key: string) => new Request('https://crm.example.com/api/crm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'update_deal', id, stage_key }) });
describe('configured sales stage HTTP boundary', () => {
  beforeEach(() => { mocks.role = 'owner'; mocks.rpc.mockReset().mockResolvedValue({ data: null, error: null }); });
  it('allows configured custom keys to reach the atomic database guard', async () => {
    expect((await POST(request('awaiting_content'))).status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith('patch_deal', { p_deal_id: id, p_patch: { stage_key: 'awaiting_content' }, p_override_reason: null });
  });
  it('honours database rejection of unknown stages and required quote evidence', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'Unknown stage or missing quote evidence' } });
    expect((await POST(request('unconfigured'))).status).toBe(400);
    expect((await POST(request('quote'))).status).toBe(400);
  });
  it('rejects blank or oversized keys and viewer mutations before any RPC', async () => {
    expect((await POST(request('  '))).status).toBe(400);
    expect((await POST(request('a'.repeat(101)))).status).toBe(400);
    mocks.role = 'viewer'; expect((await POST(request('awaiting_content'))).status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
