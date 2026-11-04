import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), after: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('@/lib/supabase/admin', () => ({ adminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/server/providers', () => ({ telegramReady: () => false, sendTelegram: vi.fn(), ProviderError: class extends Error {} }));
import { handleIngest, MAX_INGEST_BYTES } from '@/lib/server/ingest';
import { signIngest } from '@/lib/domain/security';

const dealId = 'a36c7171-7a96-46dd-bf1c-1d13b62355df';
function request(raw: string, signature?: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return new Request('http://localhost/api/ingest/website-lead', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Lumen-Timestamp': timestamp, 'X-Lumen-Signature': signature ?? signIngest(raw, timestamp, 'test-secret') }, body: raw });
}
describe('ingest HTTP boundary', () => {
  beforeEach(() => {
    vi.stubEnv('CRM_INGEST_SECRET', 'test-secret'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-key'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co'); vi.stubEnv('APP_URL', 'https://crm.example.com');
    mocks.rpc.mockReset(); mocks.after.mockReset();
    mocks.rpc.mockImplementation(async (name) => name === 'consume_rate_limit' ? { data: true, error: null } : { data: { deal_id: dealId, duplicate: false }, error: null });
  });
  it('rejects a bad HMAC before querying the database', async () => { const response = await handleIngest(request('{}', `sha256=${'0'.repeat(64)}`), 'website'); expect(response.status).toBe(401); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it('limits streamed bytes even without a Content-Length header', async () => { const response = await handleIngest(request('x'.repeat(MAX_INGEST_BYTES + 1)), 'website'); expect(response.status).toBe(413); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it('returns field errors without storing invalid data', async () => { const response = await handleIngest(request('{"name":"Dave","phone":"0491570156"}'), 'website'); expect(response.status).toBe(400); const data = await response.json(); expect(data.fields.event_id).toBeDefined(); expect(mocks.rpc).toHaveBeenCalledTimes(1); });
  it('returns the durable transaction id and schedules heavy work after response', async () => { const response = await handleIngest(request('{"name":"Dave","phone":"0491570156","event_id":"form-1"}'), 'website'); expect(response.status).toBe(200); expect(await response.json()).toEqual({ ok: true, deal_id: dealId, url: `https://crm.example.com/leads/${dealId}`, duplicate: false }); expect(mocks.after).toHaveBeenCalledTimes(1); expect(mocks.rpc.mock.calls[1][1].p_input.phone_e164).toBe('+61491570156'); });
  it('returns duplicates as successful and does not schedule a second alert', async () => { mocks.rpc.mockImplementation(async (name) => name === 'consume_rate_limit' ? { data: true, error: null } : { data: { deal_id: dealId, duplicate: true }, error: null }); const response = await handleIngest(request('{"name":"Dave","phone":"0491570156","event_id":"form-1"}'), 'website'); expect(response.status).toBe(200); expect((await response.json()).duplicate).toBe(true); expect(mocks.after).not.toHaveBeenCalled(); });
  it('uses a shared rate-limit response and does not ingest on exhaustion', async () => { mocks.rpc.mockResolvedValue({ data: false, error: null }); const response = await handleIngest(request('{}'), 'website'); expect(response.status).toBe(429); expect(response.headers.get('Retry-After')).toBe('60'); expect(mocks.rpc).toHaveBeenCalledTimes(1); });
  it('does not expose upstream database or personal data in an error', async () => { mocks.rpc.mockImplementation(async (name) => name === 'consume_rate_limit' ? { data: true, error: null } : { data: null, error: { code: 'XX000', message: 'private email dave@example.com' } }); const response = await handleIngest(request('{"name":"Dave","phone":"0491570156","event_id":"form-1"}'), 'website'); expect(response.status).toBe(500); expect(await response.text()).not.toContain('dave@example.com'); });
});
