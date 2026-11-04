import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ role: 'owner', writes: vi.fn(), existing: true, invite: vi.fn() }));
vi.mock('next/server', () => ({ after: vi.fn() }));
vi.mock('@/lib/server/invitation-job', () => ({ sendInvitationJob: mocks.invite }));
vi.mock('@/lib/server/auth', () => {
  class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
  const from = (table: string) => {
    let write: Record<string, unknown> | null = null;
    const result = () => {
      if (write) { mocks.writes(table, write); return { data: mocks.existing ? { id: 'template-id' } : null, error: null }; }
      if (table === 'settings') return { data: { config: {}, revision: 7 }, error: null };
      return { data: table === 'templates' ? [{ id: 'template-id', name: 'First reply', channel: 'sms', subject: null, body: 'Hi {first_name}', active: true }] : [], error: null };
    };
    const query = { select: () => query, is: () => query, eq: () => query, order: () => query, limit: () => query, insert: (value: Record<string, unknown>) => { write = value; return query; }, update: (value: Record<string, unknown>) => { write = value; return query; }, single: async () => result(), maybeSingle: async () => result(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve) };
    return query;
  };
  return { HttpError, requireSameOrigin: () => undefined, requireSession: async (roles: string[]) => { if (!roles.includes(mocks.role)) throw new HttpError(403, 'Forbidden'); return { db: { from }, profile: { id: 'owner', role: mocks.role } }; }, apiError: (error: unknown) => Response.json({ error: 'Blocked' }, { status: error instanceof HttpError ? error.status : 500 }) };
});
import { GET, POST } from '@/app/api/settings/route';
const template = { action: 'template', name: '  First reply  ', channel: 'sms', subject: '', body: 'Hi {first_name}, Troy from Lumen here. Thanks for your enquiry about {business}.', active: true };
const request = (body: Record<string, unknown>) => new Request('https://crm.example.com/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
describe('owner message-template settings', () => {
  beforeEach(() => { mocks.role = 'owner'; mocks.existing = true; mocks.writes.mockClear(); mocks.invite.mockClear(); });
  it('lists templates and saves known variables without sending a message', async () => {
    expect((await (await GET()).json()).templates).toHaveLength(1);
    const response = await POST(request(template));
    expect(response.status).toBe(200);
    expect((await response.json()).revision).toBe(7);
    expect(mocks.writes).toHaveBeenCalledExactlyOnceWith('templates', { name: 'First reply', channel: 'sms', subject: null, body: template.body, active: true });
    expect(mocks.invite).not.toHaveBeenCalled();
  });
  it('rejects unknown and malformed variables in the body or email subject', async () => {
    for (const patch of [{ body: 'Hi {full_name}' }, { body: 'Hi {{first_name}}' }, { body: 'Hi {first_name' }, { channel: 'email', subject: 'Quote for {company}' }]) {
      const response = await POST(request({ ...template, ...patch }));
      expect(response.status).toBe(400);
    }
    expect(mocks.writes).not.toHaveBeenCalled();
  });
  it('blocks staff and viewers and reports a disappeared edit target', async () => {
    for (const role of ['staff', 'viewer']) { mocks.role = role; expect((await GET()).status).toBe(403); expect((await POST(request(template))).status).toBe(403); }
    expect(mocks.writes).not.toHaveBeenCalled();
    mocks.role = 'owner'; mocks.existing = false;
    expect((await POST(request({ ...template, id: '00000000-0000-4000-8000-000000000001' }))).status).toBe(404);
  });
});
