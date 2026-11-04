import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { aggregateOutcomes } from '@/lib/server/jobs/outcomes';
import { DEFAULT_WORKING_HOURS } from '@/lib/domain/time';
describe('private counts-only export', () => {
  const deals = [
    { id: '1', created_at: '2026-11-04T00:00:00Z', first_touch_at: '2026-11-04T00:04:00Z', outcome: 'won', value_once: 2200 },
    { id: '2', created_at: '2026-11-04T00:00:00Z', first_touch_at: null, outcome: 'lost', value_once: null },
  ];
  const attrs = [{ deal_id: '1', meta_campaign_id: '123', meta_campaign_name: 'Tradie enquiries', utm_campaign: null, meta_ad_name: '2610_tradies_offer_h1_v1', utm_content: null }, { deal_id: '2', meta_campaign_id: '123', meta_campaign_name: 'Tradie enquiries', utm_campaign: null, meta_ad_name: '2610_tradies_offer_h1_v1', utm_content: null }];
  it('counts first-reached milestones even when the final deal stage moved back', () => {
    const result = aggregateOutcomes(deals, [{ deal_id: '1', milestone_key: 'suitable', first_reached_at: '2026-11-04T00:05:00Z' }, { deal_id: '1', milestone_key: 'won', first_reached_at: '2026-11-04T00:06:00Z' }, { deal_id: '2', milestone_key: 'suitable', first_reached_at: '2026-11-04T00:07:00Z' }], attrs, DEFAULT_WORKING_HOURS, '2026-11-04T01:00:00Z');
    expect(result.campaigns['123']).toMatchObject({ enquiries: 2, suitable: 2, won: 1, won_value: 2200, median_first_touch_mins: 4 });
    expect(result.ads['2610_tradies_offer_h1_v1'].enquiries).toBe(2);
  });
  it('uses null for no first-touch sample, and exposes no contact IDs or raw data', () => {
    const result = aggregateOutcomes([deals[1]], [], attrs, DEFAULT_WORKING_HOURS, '2026-11-04T01:00:00Z');
    expect(result.campaigns['123'].median_first_touch_mins).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/contact_id|phone|email|raw|first_name/);
  });
  it('uses a safe map even when an ad name is a JavaScript object property', () => { const result = aggregateOutcomes(deals, [], [{ ...attrs[0], meta_ad_name: '__proto__' }], DEFAULT_WORKING_HOURS, 'now'); expect(result.ads.__proto__.enquiries).toBe(1); });
});
