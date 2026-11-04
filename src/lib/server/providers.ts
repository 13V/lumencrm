import 'server-only';
import { escapeHtml } from '@/lib/domain/messaging';
import { signIngest } from '@/lib/domain/security';

export class ProviderError extends Error {
  constructor(public provider: string, public status: number | null, public uncertain = false) {
    super(uncertain ? `${provider} did not confirm the result. Check its delivery log before trying again.` : `${provider} could not accept this request${status ? ` (HTTP ${status})` : ''}.`);
  }
}
function need(name: string): string { const value = process.env[name]; if (!value) throw new Error(`${name} is not configured`); return value; }
async function sendJson(provider: string, url: string, headers: Record<string, string>, payload: unknown, timeout = 10_000): Promise<Record<string, unknown>> {
  let response: Response;
  try { response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(payload), signal: AbortSignal.timeout(timeout), cache: 'no-store' }); }
  catch { throw new ProviderError(provider, null, true); }
  if (!response.ok) throw new ProviderError(provider, response.status, response.status >= 500);
  try { return await response.json() as Record<string, unknown>; }
  catch { throw new ProviderError(provider, response.status, true); }
}
export function smsReady(): boolean { return Boolean(process.env.CLICKSEND_USERNAME && process.env.CLICKSEND_API_KEY && process.env.CLICKSEND_FROM); }
export function emailReady(): boolean { return Boolean(process.env.RESEND_API_KEY && process.env.CRM_EMAIL_FROM); }
export function telegramReady(): boolean { return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID); }

export async function sendSms(to: string, body: string): Promise<{ id: string; status: string }> {
  const authorization = Buffer.from(`${need('CLICKSEND_USERNAME')}:${need('CLICKSEND_API_KEY')}`).toString('base64');
  const result = await sendJson('ClickSend', 'https://rest.clicksend.com/v3/sms/send', { Authorization: `Basic ${authorization}` }, { messages: [{ source: 'Lumen CRM', from: need('CLICKSEND_FROM'), to, body }] });
  const data = result.data as { messages?: { status?: string; message_id?: string }[] } | undefined;
  const message = data?.messages?.[0];
  if (message?.status !== 'SUCCESS' || !message.message_id) throw new ProviderError('ClickSend', 200, message?.status === undefined);
  return { id: message.message_id, status: 'queued' };
}
export async function sendEmail(to: string, subject: string, body: string, requestId: string, attachments?: { filename: string; content: string }[]): Promise<{ id: string; status: string }> {
  const html = `<div style="font-family:Arial,sans-serif;color:#111110;max-width:600px;margin:0 auto;padding:32px 24px"><p style="font-size:22px;font-weight:600">Lumen <span style="font-weight:400">adl</span></p><div style="white-space:pre-wrap;line-height:1.6">${escapeHtml(body)}</div></div>`;
  const result = await sendJson('Resend', 'https://api.resend.com/emails', { Authorization: `Bearer ${need('RESEND_API_KEY')}`, 'Idempotency-Key': `lumen-${requestId}` }, { from: need('CRM_EMAIL_FROM'), to: [to], subject, text: body, html, ...(attachments?.length ? { attachments } : {}) });
  if (typeof result.id !== 'string') throw new ProviderError('Resend', 200, true);
  return { id: result.id, status: 'queued' };
}
export async function sendTelegram(text: string, path = '/today'): Promise<{ id: string; status: string }> {
  const url = new URL(path.startsWith('/') ? path : '/today', need('APP_URL'));
  const result = await sendJson('Telegram', `https://api.telegram.org/bot${need('TELEGRAM_BOT_TOKEN')}/sendMessage`, {}, { chat_id: need('TELEGRAM_CHAT_ID'), text: text.slice(0, 4000), reply_markup: { inline_keyboard: [[{ text: 'Open Lumen CRM', url: url.toString() }]] } });
  const message = result.result as { message_id?: number } | undefined;
  if (result.ok !== true || message?.message_id === undefined) throw new ProviderError('Telegram', 200);
  return { id: String(message.message_id), status: 'sent' };
}
export async function takeOverChloe(phone: string): Promise<void> {
  const target = new URL(need('CHLOE_TAKEOVER_URL'));
  if (target.protocol !== 'https:') throw new Error('CHLOE_TAKEOVER_URL must use HTTPS');
  const timestamp = String(Math.floor(Date.now() / 1000)), body = JSON.stringify({ phone });
  const result = await sendJson('Chloe', target.toString(), { 'X-Lumen-Timestamp': timestamp, 'X-Lumen-Signature': signIngest(body, timestamp, need('CRM_INGEST_SECRET')) }, { phone });
  if (result.ok === false) throw new ProviderError('Chloe', 200);
}
