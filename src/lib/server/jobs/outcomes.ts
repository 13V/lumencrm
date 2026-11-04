import 'server-only';
import { median } from '@/lib/domain/reports';
import { workingMinutesBetween, type WorkingHours } from '@/lib/domain/time';
import { allRows, loadJobSettings, type JobDatabase } from './shared';

export interface OutcomeDeal { id: string; created_at: string; first_touch_at: string | null; outcome: string; value_once: number | string | null; channel?: string }
export interface OutcomeMilestone { deal_id: string; milestone_key: string; first_reached_at: string }
export interface OutcomeAttribution { deal_id: string; meta_campaign_id: string | null; meta_campaign_name: string | null; utm_campaign: string | null; meta_ad_name: string | null; utm_content: string | null }
export interface OutcomeCounts { enquiries: number; contacted: number; suitable: number; call_booked: number; brief: number; demo: number; quote: number; won: number; won_value: number; median_first_touch_mins: number | null }
const milestoneKeys = ['contacted', 'suitable', 'call_booked', 'brief', 'demo', 'quote', 'won'] as const;
export function aggregateOutcomes(deals: OutcomeDeal[], milestones: OutcomeMilestone[], attribution: OutcomeAttribution[], hours: WorkingHours, asOf: string) {
  const empty = (): OutcomeCounts => ({ enquiries: 0, contacted: 0, suitable: 0, call_booked: 0, brief: 0, demo: 0, quote: 0, won: 0, won_value: 0, median_first_touch_mins: null });
  const sources = new Map(attribution.map((row) => [row.deal_id, row]));
  const reached = new Map<string, Set<string>>();
  for (const row of milestones) { if (!reached.has(row.deal_id)) reached.set(row.deal_id, new Set()); reached.get(row.deal_id)!.add(row.milestone_key); }
  const campaigns: Record<string, OutcomeCounts & { name: string }> = Object.create(null), ads: Record<string, OutcomeCounts> = Object.create(null);
  const campaignTimes = new Map<string, number[]>(), adTimes = new Map<string, number[]>();
  for (const deal of deals) {
    const source = sources.get(deal.id), campaignName = source?.meta_campaign_name || source?.utm_campaign || 'Unattributed';
    const campaignKey = source?.meta_campaign_id || (source?.utm_campaign ? `name:${source.utm_campaign}` : 'unattributed');
    const adName = source?.meta_ad_name || source?.utm_content || 'unattributed';
    campaigns[campaignKey] ??= { ...empty(), name: campaignName }; ads[adName] ??= empty();
    const buckets = [campaigns[campaignKey], ads[adName]];
    for (const bucket of buckets) {
      bucket.enquiries++;
      for (const milestone of milestoneKeys) if (reached.get(deal.id)?.has(milestone)) bucket[milestone]++;
      if (deal.outcome === 'won') bucket.won_value += Math.round(Number(deal.value_once ?? 0) * 100) / 100;
    }
    if (deal.first_touch_at) {
      const minutes = workingMinutesBetween(deal.created_at, deal.first_touch_at, hours);
      campaignTimes.set(campaignKey, [...(campaignTimes.get(campaignKey) ?? []), minutes]);
      adTimes.set(adName, [...(adTimes.get(adName) ?? []), minutes]);
    }
  }
  for (const [key, counts] of Object.entries(campaigns)) { const time = median(campaignTimes.get(key) ?? []); counts.median_first_touch_mins = time == null ? null : Math.round(time * 10) / 10; counts.won_value = Math.round(counts.won_value * 100) / 100; }
  for (const [key, counts] of Object.entries(ads)) { const time = median(adTimes.get(key) ?? []); counts.median_first_touch_mins = time == null ? null : Math.round(time * 10) / 10; counts.won_value = Math.round(counts.won_value * 100) / 100; }
  return { as_of: asOf, campaigns, ads };
}
export async function readOutcomes(db: JobDatabase, filters: { from?: string; to?: string; channel?: string } = {}) {
  const settings = await loadJobSettings(db);
  const deals = await allRows<OutcomeDeal>((from, to) => {
    let query = db.from('deals').select('id,created_at,first_touch_at,outcome,value_once,channel').is('merged_into_id', null).or('deleted_at.is.null,anonymised_at.not.is.null');
    if (filters.from) query = query.gte('created_at', filters.from);
    if (filters.to) query = query.lt('created_at', filters.to);
    if (filters.channel) query = query.eq('channel', filters.channel);
    return query.order('created_at').order('id').range(from, to);
  });
  const milestones: OutcomeMilestone[] = [], attribution: OutcomeAttribution[] = [];
  for (let offset = 0; offset < deals.length; offset += 100) {
    const ids = deals.slice(offset, offset + 100).map((deal) => deal.id);
    const [m, a] = await Promise.all([
      db.from('deal_milestones').select('deal_id,milestone_key,first_reached_at').in('deal_id', ids),
      db.from('attribution').select('deal_id,meta_campaign_id,meta_campaign_name,utm_campaign,meta_ad_name,utm_content').in('deal_id', ids),
    ]);
    if (m.error || a.error) throw new Error('outcomes_read_failed');
    milestones.push(...(m.data ?? [])); attribution.push(...(a.data ?? []));
  }
  return aggregateOutcomes(deals, milestones, attribution, settings.call_hours, new Date().toISOString());
}
