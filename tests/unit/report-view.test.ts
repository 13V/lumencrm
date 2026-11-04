import { describe, expect, it } from 'vitest';
import { buildReport, cohortKey, resolveAdAttribution, type ReportDeal, type ReportInput, type ReportSpend } from '@/lib/domain/report-view';
import { DEFAULT_WORKING_HOURS } from '@/lib/domain/time';

const now = new Date('2026-11-04T02:00:00Z');
function deal(id: string, changes: Partial<ReportDeal> = {}): ReportDeal {
  return { id, business_id: `business-${id}`, channel: 'website', stage_key: 'new', outcome: 'open', created_at: '2026-11-04T00:00:00Z', first_touch_at: null, two_way_at: null, value_once: null, ...changes };
}
function input(changes: Partial<ReportInput> = {}): ReportInput { return { deals: [], attribution: [], milestones: [], spend: [], businesses: [], subscriptions: [], invoices: [], payments: [], ...changes }; }
const spend: ReportSpend = { date: '2026-11-04', campaign_id: 'campaign-1', campaign_name: 'Tradies', adset_id: 'set-1', adset_name: 'Adelaide', ad_id: 'ad-1', ad_name: 'Homepage demo', spend: 300 };

describe('reports from stored outcomes', () => {
  it('keeps zero customer denominators empty and spends counted only once', () => {
    const result = buildReport(input({ deals: [deal('1'), deal('2'), deal('3')], attribution: ['1', '2', '3'].map((deal_id) => ({ deal_id, utm_content: spend.ad_name, utm_campaign: spend.campaign_name })), spend: [spend] }), {}, now);
    expect(result.ads.ad).toHaveLength(1);
    expect(result.ads.ad[0]).toMatchObject({ spend: 300, enquiries: 3, won: 0, cost_per_enquiry: 100, cost_per_customer: null });
    expect(result.presales.minutes_per_customer).toBeNull();
    expect(result.speed.first_touch).toEqual({ median: null, p90: null, sample: 0 });
    expect(result.speed.within_target.rate).toBeNull();
  });

  it('uses first milestone history without inventing stages skipped by a deal', () => {
    const result = buildReport(input({ deals: [deal('1', { stage_key: 'contacted' }), deal('2', { stage_key: 'quote' })], milestones: [
      { deal_id: '1', milestone_key: 'demo', first_reached_at: '2026-11-04T00:10:00Z' },
      { deal_id: '1', milestone_key: 'demo', first_reached_at: '2026-11-04T00:20:00Z' },
      { deal_id: '2', milestone_key: 'quote', first_reached_at: '2026-11-04T00:30:00Z' },
    ] }), {}, now);
    expect(result.funnel.find((stage) => stage.key === 'demo')).toMatchObject({ count: 1, denominator: 2, rate: 0.5 });
    expect(result.funnel.find((stage) => stage.key === 'suitable')?.count).toBe(0);
    expect(result.cohorts[0].stages.demo).toBe(1);
  });

  it('does not assign the same enquiry to two ads sharing a name', () => {
    const second = { ...spend, ad_id: 'ad-2', spend: 200 };
    const result = buildReport(input({ deals: [deal('1')], attribution: [{ deal_id: '1', utm_campaign: 'Tradies', utm_content: 'Homepage demo' }], spend: [spend, second] }), {}, now);
    expect(result.ads.campaign).toHaveLength(1);
    expect(result.ads.campaign[0]).toMatchObject({ spend: 500, enquiries: 1 });
    expect(result.ads.ad.filter((row) => row.spend != null).every((row) => row.enquiries === 0)).toBe(true);
    expect(result.ads.ad.find((row) => row.enquiries === 1)).toMatchObject({ spend: null, cost_per_enquiry: null });
    expect(result.ads.matched_by_campaign).toBe(1);
    expect(result.ads.ad.reduce((sum, row) => sum + row.enquiries, 0)).toBe(1);
  });

  it('matches Meta by ID and website names within their campaign, including an old ad name', () => {
    const other = { ...spend, ad_id: 'other-ad', campaign_id: 'other-campaign', campaign_name: 'Clinics' };
    expect(resolveAdAttribution({ deal_id: '1', meta_ad_id: 'other-ad' }, [spend, other]).campaign.key).toBe('other-campaign');
    expect(resolveAdAttribution({ deal_id: '1', utm_campaign: 'Tradies', utm_content: 'Homepage demo' }, [spend, other]).ad.key).toBe('ad-1');
    expect(resolveAdAttribution({ deal_id: '1', utm_content: 'Homepage demo' }, [spend, other]).method).toBe('unmatched');
    expect(resolveAdAttribution({ deal_id: '1', utm_content: 'Homepage demo' }, [spend, { ...spend, date: '2026-11-05', ad_name: 'Renamed demo' }]).ad.key).toBe('ad-1');
  });

  it('includes lost presales and anonymous outcomes but excludes merges and the bin', () => {
    const result = buildReport(input({ deals: [deal('1', { outcome: 'won', presales_minutes: 30, demo_build_minutes: 60 }), deal('2', { outcome: 'lost', presales_minutes: 20, demo_build_minutes: 100, deleted_at: now.toISOString(), anonymised_at: now.toISOString() }), deal('3', { merged_into_id: '1', presales_minutes: 500 }), deal('4', { deleted_at: now.toISOString(), presales_minutes: 500 })], milestones: [{ deal_id: '1', milestone_key: 'suitable', first_reached_at: now.toISOString() }] }), {}, now);
    expect(result.sample).toBe(2);
    expect(result.presales).toEqual({ minutes: 210, won: 1, minutes_per_customer: 210, minutes_per_qualified: 210 });
    expect(result.pipeline.win_by_source[0]).toMatchObject({ won: 1, closed: 2, rate: 0.5 });
  });

  it('calculates speed in Adelaide working time, excluding weekends and configured holidays', () => {
    // Friday 4:58pm to Tuesday 9:03am, with Monday marked as a holiday.
    const result = buildReport(input({ deals: [deal('1', { created_at: '2026-10-30T06:28:00Z', first_touch_at: '2026-11-02T22:33:00Z', two_way_at: '2026-11-02T22:38:00Z' }), deal('2')] }), {}, now, { ...DEFAULT_WORKING_HOURS, holidays: ['2026-11-02'] });
    expect(result.speed.first_touch).toEqual({ median: 5, p90: 5, sample: 1 });
    expect(result.speed.two_way.median).toBe(10);
    expect(result.speed.within_target).toEqual({ count: 1, denominator: 1, rate: 1 });
    expect(result.speed.awaiting_first_touch).toBe(1);
  });

  it('keeps current MRR separate and deducts partial payments from invoice balances', () => {
    const result = buildReport(input({ subscriptions: [
      { id: 'a', price: 49, status: 'active', started_on: '2026-01-01', cancelled_on: null },
      { id: 'b', price: 49, status: 'paused', started_on: '2026-01-01', cancelled_on: null },
      { id: 'c', price: 49, status: 'cancelled', started_on: '2026-01-01', cancelled_on: '2026-11-03' },
    ], invoices: [{ id: 'i1', total: 2200, status: 'part_paid', due_on: '2026-11-03' }, { id: 'i2', total: 49, status: 'sent', due_on: '2026-11-10' }, { id: 'i3', total: 100, status: 'draft', due_on: '2026-10-01' }], payments: [{ invoice_id: 'i1', amount: 500 }, { invoice_id: 'i1', amount: 600 }] }), { source: 'referral', from: '2026-11-01', to: '2026-11-04' }, now);
    expect(result.clients).toMatchObject({ mrr: 49, active: 1, paused: 1, cancelled_in_period: 1, outstanding: 1149, overdue: 1100, invoice_count: 2 });
  });

  it('uses inclusive Adelaide enquiry dates and allows filtering ads with spend but no enquiries', () => {
    const result = buildReport(input({ deals: [deal('1', { created_at: '2026-11-03T14:00:00Z' }), deal('2', { created_at: '2026-11-03T12:00:00Z' })], businesses: [{ id: 'business-1', trade: 'Electrician' }, { id: 'business-2', trade: 'Plumber' }], spend: [spend] }), { from: '2026-11-04', to: '2026-11-04', trade: 'Electrician' }, now);
    expect(result.sample).toBe(1);
    expect(result.options.ads).toContain('Homepage demo');
    expect(cohortKey('2026-11-01T14:00:00Z', 'week')).toBe('2026-11-02');
    expect(cohortKey('2026-10-31T14:00:00Z', 'month')).toBe('2026-11');
  });
});
