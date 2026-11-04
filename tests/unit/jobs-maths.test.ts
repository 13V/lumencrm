import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { dailyDue, localClock } from '@/lib/server/jobs/shared';
import { nextBillingDate } from '@/lib/server/jobs/automations';
import { retentionCutoff } from '@/lib/server/jobs/privacy';
import { insightToRow, metaLeadCount } from '@/lib/server/jobs/meta';
import { trustedPushEndpoint } from '@/lib/server/jobs/push';

describe('scheduled business rules', () => {
  it('uses Adelaide time for the digest across daylight saving', () => {
    expect(dailyDue(new Date('2026-11-03T20:59:00Z'), '07:30')).toBe(false);
    expect(dailyDue(new Date('2026-11-03T21:00:00Z'), '07:30')).toBe(true);
    expect(localClock(new Date('2026-07-01T22:00:00Z')).time).toBe('07:30');
  });
  it('never schedules the weekday-and-Saturday digest on Sunday', () => expect(dailyDue(new Date('2026-11-08T01:00:00Z'), '07:30', [1, 2, 3, 4, 5, 6])).toBe(false));
  it('keeps monthly billing on the configured date through December', () => { expect(nextBillingDate('2026-12-28', 28)).toBe('2027-01-28'); expect(nextBillingDate('2026-01-28', 28)).toBe('2026-02-28'); });
  it('clamps leap-day retention to the end of February instead of March', () => expect(retentionCutoff('2024-02-29', 12)).toBe('2023-02-27T13:30:00.000Z'));
});
describe('Meta insights mapping', () => {
  it('does not double-count aggregate leads and their component action types', () => expect(metaLeadCount([{ action_type: 'lead', value: '5' }, { action_type: 'onsite_conversion.lead_grouped', value: '3' }, { action_type: 'offsite_conversion.fb_pixel_lead', value: '2' }])).toBe(5));
  it('maps link clicks from the documented API field', () => expect(insightToRow({ date_start: '2026-11-04', ad_id: '123', spend: '300.00', impressions: '5000', clicks: '35', inline_link_clicks: '30' }, '2026-11-04T00:00:00Z')).toMatchObject({ date: '2026-11-04', ad_id: '123', spend: 300, link_clicks: 30, meta_leads: 0 }));
  it('rejects invalid numbers rather than importing misleading totals', () => expect(() => insightToRow({ date_start: '2026-11-04', ad_id: '123', spend: '-1' }, '')).toThrow());
});
describe('push endpoints', () => {
  it('allows the browser push providers without allowing arbitrary server requests', () => {
    expect(trustedPushEndpoint('https://web.push.apple.com/example')).toBe(true);
    expect(trustedPushEndpoint('https://fcm.googleapis.com/fcm/send/example')).toBe(true);
    expect(trustedPushEndpoint('http://127.0.0.1/admin')).toBe(false);
    expect(trustedPushEndpoint('https://fcm.googleapis.com.evil.example/')).toBe(false);
    expect(trustedPushEndpoint('https://fcm.googleapis.com:8080/')).toBe(false);
  });
});
