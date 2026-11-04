import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ exchange: vi.fn(), verify: vi.fn(), member: vi.fn(), signOut: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ serverClient: async () => ({ auth: { exchangeCodeForSession: mock.exchange, verifyOtp: mock.verify, signOut: mock.signOut }, rpc: mock.member }) }));
import { GET } from '@/app/auth/callback/route';
beforeEach(() => { vi.clearAllMocks(); mock.exchange.mockResolvedValue({ error: null }); mock.verify.mockResolvedValue({ error: null }); mock.member.mockResolvedValue({ error: null }); mock.signOut.mockResolvedValue({ error: null }); });
describe('server-side email callback', () => {
  it('verifies invitation hashes without a browser-bound PKCE verifier', async () => {
    const result = await GET(new Request('https://crm.example.com/auth/callback?token_hash=fictional-hash&type=invite'));
    expect(mock.verify).toHaveBeenCalledWith({ token_hash: 'fictional-hash', type: 'invite' });
    expect(mock.exchange).not.toHaveBeenCalled(); expect(mock.member).toHaveBeenCalledWith('accept_invitation');
    expect(result.headers.get('location')).toBe('https://crm.example.com/today');
  });
  it('keeps PKCE sign-in links working', async () => {
    const result = await GET(new Request('https://crm.example.com/auth/callback?code=fictional-code'));
    expect(mock.exchange).toHaveBeenCalledWith('fictional-code'); expect(result.status).toBe(307);
  });
  it('does not accept arbitrary OTP actions or an uninvited membership', async () => {
    const invalid = await GET(new Request('https://crm.example.com/auth/callback?token_hash=fictional-hash&type=recovery'));
    expect(mock.verify).not.toHaveBeenCalled(); expect(invalid.headers.get('location')).toContain('/login?error=link');
    mock.member.mockResolvedValue({ error: { message: 'Not invited' } });
    const denied = await GET(new Request('https://crm.example.com/auth/callback?token_hash=fictional-hash&type=email'));
    expect(mock.signOut).toHaveBeenCalledOnce(); expect(denied.headers.get('location')).toContain('/login?error=link');
  });
});
