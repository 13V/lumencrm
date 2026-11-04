import { createHmac, timingSafeEqual, createHash, randomBytes } from 'node:crypto';

export function signIngest(rawBody: string, timestamp: string | number, secret: string): string {
  if (!secret) throw new Error('Ingest secret is not configured');
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex')}`;
}
export function verifyIngestSignature(rawBody: string, timestamp: string | null, signature: string | null, secret: string | undefined, nowSeconds = Date.now() / 1000): boolean {
  if (!secret || !timestamp || !/^\d{1,12}$/.test(timestamp) || !signature || !/^sha256=[a-fA-F0-9]{64}$/.test(signature)) return false;
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(nowSeconds - seconds) > 300) return false;
  const expected = Buffer.from(signIngest(rawBody, timestamp, secret).slice(7), 'hex');
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}
export function secureToken(): string { return randomBytes(32).toString('base64url'); }
export function tokenHash(token: string): string { return createHash('sha256').update(token).digest('hex'); }
export function timingSafeToken(candidate: string | null, expected: string | undefined): boolean {
  if (!candidate || !expected) return false;
  return timingSafeEqual(createHash('sha256').update(candidate).digest(), createHash('sha256').update(expected).digest());
}
export function ingestIdempotencyKey(source: 'website' | 'meta' | 'chloe', input: { event_id?: string; leadgen_id?: string; phone?: string; at?: string; type?: string }): string {
  if (source === 'website' && input.event_id?.trim()) return input.event_id.trim();
  if (source === 'meta' && input.leadgen_id?.trim()) return input.leadgen_id.trim();
  if (source === 'chloe' && input.phone && input.at && input.type) return `chloe:${input.phone}:${input.at}:${input.type}`;
  throw new Error('A stable idempotency key is required');
}
