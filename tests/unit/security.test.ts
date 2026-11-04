import { describe, expect, it } from 'vitest';
import { signIngest, verifyIngestSignature, ingestIdempotencyKey, secureToken } from '@/lib/domain/security';
describe('signed integration boundary', () => {
  const body = '{"name":"Fictional","phone":"0491570156"}', timestamp = '1793768867', secret = 'unit-test-secret-only';
  it('verifies exact bytes, not a re-serialised object', () => { const signature = signIngest(body, timestamp, secret); expect(verifyIngestSignature(body, timestamp, signature, secret, Number(timestamp))).toBe(true); expect(verifyIngestSignature(`${body}\n`, timestamp, signature, secret, Number(timestamp))).toBe(false); });
  it('rejects a replay more than 300 seconds old or in the future', () => { const signature = signIngest(body, timestamp, secret); expect(verifyIngestSignature(body, timestamp, signature, secret, Number(timestamp) + 301)).toBe(false); expect(verifyIngestSignature(body, timestamp, signature, secret, Number(timestamp) - 301)).toBe(false); expect(verifyIngestSignature(body, timestamp, signature, secret, Number(timestamp) + 300)).toBe(true); });
  it('rejects malformed signatures and missing secrets without throwing', () => { expect(verifyIngestSignature(body, timestamp, 'sha256=00', secret)).toBe(false); expect(verifyIngestSignature(body, timestamp, null, secret)).toBe(false); expect(verifyIngestSignature(body, timestamp, 'a'.repeat(64), undefined)).toBe(false); });
  it('produces stable idempotency keys from upstream identities', () => {
    expect(ingestIdempotencyKey('website', { event_id: 'event-123' })).toBe('event-123');
    expect(ingestIdempotencyKey('meta', { leadgen_id: '123456' })).toBe('123456');
    expect(ingestIdempotencyKey('chloe', { phone: '+61491570156', at: '2026-11-04T05:07:47Z', type: 'message_in' })).toBe('chloe:+61491570156:2026-11-04T05:07:47Z:message_in');
    expect(() => ingestIdempotencyKey('website', {})).toThrow();
  });
  it('creates a 32-byte base64url public token', () => { const first = secureToken(); expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/); expect(Buffer.from(first, 'base64url')).toHaveLength(32); expect(secureToken()).not.toBe(first); });
});
