import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { sendEmail, sendSms, sendTelegram, takeOverChloe } from '@/lib/server/providers';
import { verifyIngestSignature } from '@/lib/domain/security';

describe('provider contracts without external sends', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock);
    for (const [key, value] of Object.entries({ CLICKSEND_USERNAME: 'test-user', CLICKSEND_API_KEY: 'test-key', CLICKSEND_FROM: '+61491570156', RESEND_API_KEY: 'test-resend', CRM_EMAIL_FROM: 'Lumen adl <crm@example.com>', TELEGRAM_BOT_TOKEN: 'test-bot-token', TELEGRAM_CHAT_ID: 'test-chat', APP_URL: 'https://crm.example.com', CHLOE_TAKEOVER_URL: 'https://www.example.com/chloe/takeover', CRM_INGEST_SECRET: 'test-secret' })) vi.stubEnv(key, value);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it('uses ClickSend v3 and distinguishes queued from delivered', async () => {
    fetchMock.mockResolvedValue(Response.json({ data: { messages: [{ status: 'SUCCESS', message_id: 'sms-id' }] } }));
    expect(await sendSms('+61491570156', 'Test text')).toEqual({ id: 'sms-id', status: 'queued' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://rest.clicksend.com/v3/sms/send');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ messages: [{ source: 'Lumen CRM', from: '+61491570156', to: '+61491570156', body: 'Test text' }] });
  });
  it('does not confuse HTTP 200 with per-message ClickSend success', async () => { fetchMock.mockResolvedValue(Response.json({ data: { messages: [{ status: 'INSUFFICIENT_CREDIT' }] } })); await expect(sendSms('+61491570156', 'Test')).rejects.toThrow('ClickSend could not accept'); });
  it('sends both email formats and escapes content before wrapping', async () => {
    fetchMock.mockResolvedValue(Response.json({ id: 'email-id' }));
    await sendEmail('dave@example.com', 'Test', '<script>bad</script>', 'test-uuid');
    const init = fetchMock.mock.calls[0][1], payload = JSON.parse(init.body);
    expect(init.headers['Idempotency-Key']).toBe('lumen-test-uuid'); expect(payload.text).toBe('<script>bad</script>'); expect(payload.html).not.toContain('<script>'); expect(payload.html).toContain('&lt;script&gt;');
  });
  it('does not include provider bodies or recipient data in failures', async () => { fetchMock.mockResolvedValue(new Response('Failed for dave@example.com secret=test-resend', { status: 500 })); await expect(sendEmail('dave@example.com', 'Test', 'Test', 'test-id')).rejects.toThrow('Resend did not confirm'); });
  it('adds a CRM deep link to Telegram and checks the API success flag', async () => { fetchMock.mockResolvedValue(Response.json({ ok: true, result: { message_id: 123 } })); expect(await sendTelegram('An enquiry is waiting.', '/today')).toEqual({ id: '123', status: 'sent' }); const payload = JSON.parse(fetchMock.mock.calls[0][1].body); expect(payload.reply_markup.inline_keyboard[0][0].url).toBe('https://crm.example.com/today'); });
  it('signs the exact Chloe takeover body and refuses non-HTTPS destinations', async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true })); await takeOverChloe('+61491570156');
    const init = fetchMock.mock.calls[0][1]; expect(verifyIngestSignature(init.body, init.headers['X-Lumen-Timestamp'], init.headers['X-Lumen-Signature'], 'test-secret')).toBe(true);
    vi.stubEnv('CHLOE_TAKEOVER_URL', 'http://example.com/takeover'); await expect(takeOverChloe('+61491570156')).rejects.toThrow('HTTPS');
  });
});
