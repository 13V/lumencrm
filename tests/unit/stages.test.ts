import { describe, expect, it } from 'vitest';
import { assertStageTransition, recordFirstMilestone, closeDeal } from '@/lib/domain';
describe('sales stage guard', () => {
  it('requires evidence for contacted, quote sent and won', () => {
    expect(() => assertStageTransition('contacted', {})).toThrow('reply');
    expect(() => assertStageTransition('quote', {})).toThrow('Send a quote');
    expect(() => assertStageTransition('won', {})).toThrow('accepted quote');
    expect(() => assertStageTransition('won', { override_reason: '  ' })).toThrow();
  });
  it('accepts a sent quote and a documented override', () => {
    expect(() => assertStageTransition('quote', { sent_quote: true })).not.toThrow();
    expect(() => assertStageTransition('won', { accepted_quote: true })).not.toThrow();
    expect(() => assertStageTransition('won', { override_reason: 'Signed agreement received in person' })).not.toThrow();
  });
  it('preserves first milestone times when a deal moves back and forward', () => {
    const history = { suitable: '2026-11-01T00:00:00Z' };
    expect(recordFirstMilestone(history, 'suitable', '2026-11-04T00:00:00Z')).toEqual(history);
  });
  it('keeps the last stage when the outcome closes', () => expect(closeDeal({ stage_key: 'demo' }, 'lost', '2026-11-04T00:00:00Z')).toEqual({ stage_key: 'demo', outcome: 'lost', closed_at: '2026-11-04T00:00:00Z' }));
});
