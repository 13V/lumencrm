import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), sendSms: vi.fn(), sendEmail: vi.fn() }));
vi.mock('@/lib/server/auth', () => {
  class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
  return { HttpError, requireSameOrigin: () => {}, requireSession: async () => ({ db: { rpc: mocks.rpc } }), apiError: (error: unknown) => Response.json({ error: error instanceof Error ? error.message : 'Error' }, { status: error instanceof HttpError ? error.status : 500 }) };
});
vi.mock('@/lib/server/providers', () => ({ emailReady: () => true, smsReady: () => true, sendEmail: mocks.sendEmail, sendSms: mocks.sendSms, ProviderError: class extends Error {} }));
import { POST } from '@/app/api/messages/route';
const dealId = 'a36c7171-7a96-46dd-bf1c-1d13b62355df', requestId = 'd197a9da-6779-4ee1-9fd2-e37c06dc8e26';
const request = (body: Record<string, unknown>) => new Request('https://crm.example.com/api/messages', { method: 'POST', headers: { Origin: 'https://crm.example.com', 'Content-Type': 'application/json' }, body: JSON.stringify({ deal_id: dealId, request_id: requestId, channel: 'sms', body: 'Hi, Troy from Lumen here.', ...body }) });
describe('explicit human message sends', () => {
  beforeEach(() => {
    mocks.rpc.mockReset(); mocks.sendSms.mockReset(); mocks.sendEmail.mockReset();
    mocks.rpc.mockImplementation(async (name) => name === 'prepare_message' ? { data: { activity_id: requestId, duplicate: false, contact_id: requestId, phone_e164: '+61491570156' }, error: null } : { data: null, error: null });
    mocks.sendSms.mockResolvedValue({ id: 'provider-id', status: 'queued' });
  });
  it('never invokes the provider when the atomic consent guard refuses', async () => { mocks.rpc.mockResolvedValue({ data: null, error: { code: '23514' } }); expect((await POST(request({}))).status).toBe(409); expect(mocks.sendSms).not.toHaveBeenCalled(); });
  it('does not send a request twice on a repeated button submission', async () => { mocks.rpc.mockResolvedValue({ data: { activity_id: requestId, duplicate: true }, error: null }); const response = await POST(request({})); expect(response.status).toBe(200); expect((await response.json()).duplicate).toBe(true); expect(mocks.sendSms).not.toHaveBeenCalled(); });
  it('asks for an explicit decision above three segments before reserving a send', async () => { const response = await POST(request({ body: 'a'.repeat(460) })); expect(response.status).toBe(422); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.sendSms).not.toHaveBeenCalled(); });
  it('includes the unsubscribe instruction and records queued status accurately', async () => { const response = await POST(request({})); expect(response.status).toBe(200); expect(mocks.sendSms).toHaveBeenCalledWith('+61491570156', 'Hi, Troy from Lumen here.\nReply STOP to opt out.'); expect(mocks.rpc).toHaveBeenLastCalledWith('finalise_message', { p_activity_id: requestId, p_status: 'queued', p_provider_id: 'provider-id' }); });
  it('requires a stable UUID for each user-approved send', async () => { expect((await POST(request({ request_id: 'not-a-uuid' }))).status).toBe(400); expect(mocks.sendSms).not.toHaveBeenCalled(); });
});
