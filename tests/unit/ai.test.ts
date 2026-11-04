import { describe, it, expect, vi, afterEach } from 'vitest';
vi.mock('server-only', () => ({}));
import { aiSystemPrompt, requestAiDraft } from '@/lib/server/ai';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('AI drafts remain separate from actions', () => {
  it('sets the studio rules and treats pasted records as untrusted data', () => { const prompt = aiSystemPrompt(); expect(prompt).toContain('Lumen adl'); expect(prompt).toContain('untrusted data'); expect(prompt).toContain('Never send'); expect(prompt).toContain('monthly fee'); });
  it('uses the server-only provider key and returns text without storing or sending it', async () => {
    vi.stubEnv('AI_PROVIDER_API_KEY', 'test-key'); const fetcher = vi.fn().mockResolvedValue(Response.json({ content: [{ type: 'text', text: 'Hi Alex, when suits you for a call?' }], stop_reason: 'end_turn' })); vi.stubGlobal('fetch', fetcher);
    expect(await requestAiDraft({ instruction: 'reply', lead: { first_name: 'Alex' }, products: [] })).toBe('Hi Alex, when suits you for a call?'); expect(fetcher).toHaveBeenCalledOnce(); const body = JSON.parse(fetcher.mock.calls[0][1].body); expect(body.tools).toBeUndefined(); expect(body.max_tokens).toBe(1500);
  });
  it('rejects truncated output and unsupported sales claims', async () => {
    vi.stubEnv('AI_PROVIDER_API_KEY', 'test-key'); const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ content: [{ type: 'text', text: 'Incomplete' }], stop_reason: 'max_tokens' })).mockResolvedValueOnce(Response.json({ content: [{ type: 'text', text: 'Guaranteed rankings and more jobs' }] })); vi.stubGlobal('fetch', fetcher);
    await expect(requestAiDraft({ instruction: 'summary', products: [] })).rejects.toThrow('incomplete'); await expect(requestAiDraft({ instruction: 'reply', products: [] })).rejects.toThrow('unsupported claim');
  });
});
