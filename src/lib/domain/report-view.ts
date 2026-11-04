import { DEFAULT_WORKING_HOURS, workingMinutesBetween, type WorkingHours } from './time';
import { median, percentile } from './reports';
import { SALES_STAGES } from './stages';
import { formatInTimeZone } from 'date-fns-tz';

export interface ReportDeal {
  id: string; business_id: string | null; channel: string; stage_key: string; outcome: string; created_at: string;
  stage_entered_at?: string; closed_at?: string | null; first_touch_at: string | null; two_way_at: string | null;
  value_once: number | string | null; value_monthly?: number | string | null; presales_minutes?: number; demo_build_minutes?: number;
  deleted_at?: string | null; anonymised_at?: string | null; merged_into_id?: string | null;
}
export interface ReportAttribution {
  deal_id: string; utm_campaign?: string | null; utm_term?: string | null; utm_content?: string | null;
  meta_campaign_id?: string | null; meta_campaign_name?: string | null; meta_adset_id?: string | null; meta_adset_name?: string | null; meta_ad_id?: string | null; meta_ad_name?: string | null;
}
export interface ReportSpend { date: string; campaign_id: string | null; campaign_name: string | null; adset_id: string | null; adset_name: string | null; ad_id: string; ad_name: string | null; spend: number | string }
export interface ReportMilestone { deal_id: string; milestone_key: string; first_reached_at: string }
export interface ReportSubscription { id: string; price: number | string; status: string; started_on: string; cancelled_on: string | null }
export interface ReportInvoice { id: string; total: number | string; status: string; due_on: string }
export interface ReportInput {
  deals: ReportDeal[]; attribution: ReportAttribution[]; milestones: ReportMilestone[]; spend: ReportSpend[];
  businesses: { id: string; trade: string | null }[]; subscriptions: ReportSubscription[]; invoices: ReportInvoice[]; payments: { invoice_id: string; amount: number | string }[];
  products?: { name: string; kind: string; price: number | string }[];
}
export interface ReportFilters { source?: string; campaign?: string; adset?: string; ad?: string; trade?: string; from?: string; to?: string; cohort?: 'week' | 'month' }
export interface ReportCount { count: number; denominator: number; rate: number | null }
export interface AdsRow { key: string; name: string; spend: number | null; enquiries: number; suitable: number; call_booked: number; demo: number; quote: number; won: number; won_value: number; cost_per_enquiry: number | null; cost_per_suitable: number | null; cost_per_demo: number | null; cost_per_customer: number | null }
export interface ReportView {
  as_of: string; sample: number; filters: ReportFilters;
  options: { sources: string[]; campaigns: string[]; adsets: string[]; ads: string[]; trades: string[] };
  funnel: { key: string; label: string; count: number; denominator: number; rate: number | null }[];
  cohorts: { key: string; enquiries: number; stages: Record<string, number> }[];
  speed: { first_touch: { median: number | null; p90: number | null; sample: number }; two_way: { median: number | null; p90: number | null; sample: number }; within_target: ReportCount; target_minutes: number; awaiting_first_touch: number };
  ads: { campaign: AdsRow[]; adset: AdsRow[]; ad: AdsRow[]; matched_by_ad: number; matched_by_campaign: number; unmatched: number; note: string };
  presales: { minutes: number; won: number; minutes_per_customer: number | null; minutes_per_qualified: number | null };
  pipeline: { stages: { key: string; label: string; count: number; value_once: number | null; stale: number }[]; win_by_source: { source: string; won: number; closed: number; rate: number | null }[] };
  clients: { mrr: number | null; active: number; paused: number; cancelled_in_period: number; outstanding: number | null; overdue: number | null; invoice_count: number; scope: string };
  calculator_defaults: { revenue: number | null; presales_minutes: number | null };
}
const countStages = ['contacted', 'suitable', 'call_booked', 'brief', 'demo', 'quote', 'won'] as const;
const distinct = (values: (string | null | undefined)[]) => [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));
const moneySum = (values: (number | string | null | undefined)[]) => values.reduce<number>((sum, value) => sum + Math.round(Number(value ?? 0) * 100), 0) / 100;
const matches = (filter: string | undefined, ...values: (string | null | undefined)[]) => !filter || values.includes(filter);
function countRate(count: number, denominator: number): ReportCount { return { count, denominator, rate: denominator ? count / denominator : null }; }
export function cohortKey(value: string, granularity: 'week' | 'month'): string {
  const day = formatInTimeZone(value, 'Australia/Adelaide', 'yyyy-MM-dd');
  if (granularity === 'month') return day.slice(0, 7);
  const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7)); return date.toISOString().slice(0, 10);
}
type Group = { key: string; name: string };
interface AttributionMatch { campaign: Group; adset: Group; ad: Group; method: 'ad' | 'campaign' | 'unmatched' }
export function resolveAdAttribution(value: ReportAttribution | undefined, spend: ReportSpend[]): AttributionMatch {
  const unassigned = { key: 'unattributed', name: 'Unattributed enquiries' };
  if (!value) return { campaign: unassigned, adset: unassigned, ad: unassigned, method: 'unmatched' };
  const latestAds = (rows: ReportSpend[]) => [...new Map([...rows].sort((a, b) => a.date.localeCompare(b.date)).map((row) => [row.ad_id, row])).values()];
  const uniqueAds = latestAds(spend);
  const byId = value.meta_ad_id ? uniqueAds.filter((row) => row.ad_id === value.meta_ad_id) : [];
  const byName = !value.meta_ad_id && value.utm_content ? latestAds(spend.filter((row) => row.ad_name === value.utm_content && (!value.utm_campaign || row.campaign_name === value.utm_campaign))) : [];
  const candidates = byId.length ? byId : byName;
  if (candidates.length === 1) {
    const row = candidates[0];
    return { campaign: { key: row.campaign_id || `name:${row.campaign_name}`, name: row.campaign_name || 'Unnamed campaign' }, adset: { key: row.adset_id || `name:${row.campaign_id}:${row.adset_name}`, name: row.adset_name || 'Unnamed ad set' }, ad: { key: row.ad_id, name: row.ad_name || row.ad_id }, method: 'ad' };
  }
  const campaigns = [...new Map(spend.filter((row) => value.meta_campaign_id ? row.campaign_id === value.meta_campaign_id : Boolean(value.utm_campaign && row.campaign_name === value.utm_campaign)).map((row) => [row.campaign_id || `name:${row.campaign_name}`, row])).values()];
  if (campaigns.length === 1) {
    const row = campaigns[0], campaign = { key: row.campaign_id || `name:${row.campaign_name}`, name: row.campaign_name || 'Unnamed campaign' };
    const fallback = { key: `campaign_only:${campaign.key}`, name: `Campaign only · ${campaign.name}` };
    return { campaign, adset: fallback, ad: fallback, method: 'campaign' };
  }
  const campaignName = value.meta_campaign_name || value.utm_campaign;
  return {
    campaign: campaignName ? { key: value.meta_campaign_id || `name:${campaignName}`, name: `${campaignName} · no matched spend` } : unassigned,
    adset: value.meta_adset_name || value.utm_term ? { key: `unmatched:${value.meta_adset_id || value.utm_term || value.meta_adset_name}`, name: `${value.meta_adset_name || value.utm_term} · no matched spend` } : unassigned,
    ad: value.meta_ad_name || value.utm_content ? { key: `unmatched:${value.meta_ad_id || value.utm_content || value.meta_ad_name}`, name: `${value.meta_ad_name || value.utm_content} · no matched spend` } : unassigned,
    method: 'unmatched',
  };
}

export function buildReport(input: ReportInput, filters: ReportFilters = {}, now = new Date(), hours: WorkingHours = DEFAULT_WORKING_HOURS, targetMinutes = 5, stages: readonly { key: string; label: string }[] = SALES_STAGES): ReportView {
  const attribution = new Map(input.attribution.map((row) => [row.deal_id, row])), businesses = new Map(input.businesses.map((row) => [row.id, row]));
  const validDeals = input.deals.filter((deal) => !deal.merged_into_id && (!deal.deleted_at || Boolean(deal.anonymised_at)));
  const datesMatch = (date: string) => (!filters.from || date >= filters.from) && (!filters.to || date <= filters.to);
  const deals = validDeals.filter((deal) => {
    const attr = attribution.get(deal.id);
    return matches(filters.source, deal.channel) && matches(filters.campaign, attr?.meta_campaign_id, attr?.meta_campaign_name, attr?.utm_campaign)
      && matches(filters.adset, attr?.meta_adset_id, attr?.meta_adset_name, attr?.utm_term) && matches(filters.ad, attr?.meta_ad_id, attr?.meta_ad_name, attr?.utm_content)
      && matches(filters.trade, businesses.get(deal.business_id ?? '')?.trade) && datesMatch(formatInTimeZone(deal.created_at, 'Australia/Adelaide', 'yyyy-MM-dd'));
  });
  const ids = new Set(deals.map((deal) => deal.id)), reached = new Map<string, Set<string>>();
  for (const milestone of input.milestones) { if (!ids.has(milestone.deal_id)) continue; if (!reached.has(milestone.deal_id)) reached.set(milestone.deal_id, new Set()); reached.get(milestone.deal_id)!.add(milestone.milestone_key); }
  const stageCount = (key: string) => deals.filter((deal) => reached.get(deal.id)?.has(key)).length;
  const funnel = [{ key: 'enquiries', label: 'Enquiries', ...countRate(deals.length, deals.length) }, ...countStages.map((key) => ({ key, label: stages.find((stage) => stage.key === key)?.label || key, ...countRate(stageCount(key), deals.length) }))];
  const cohorts = new Map<string, { key: string; enquiries: number; stages: Record<string, number> }>();
  for (const deal of deals) {
    const key = cohortKey(deal.created_at, filters.cohort ?? 'month');
    if (!cohorts.has(key)) cohorts.set(key, { key, enquiries: 0, stages: Object.fromEntries(countStages.map((stage) => [stage, 0])) });
    const cohort = cohorts.get(key)!; cohort.enquiries++;
    for (const stage of countStages) if (reached.get(deal.id)?.has(stage)) cohort.stages[stage]++;
  }
  const first = deals.filter((deal) => deal.first_touch_at).map((deal) => workingMinutesBetween(deal.created_at, deal.first_touch_at!, hours));
  const twoWay = deals.filter((deal) => deal.two_way_at).map((deal) => workingMinutesBetween(deal.created_at, deal.two_way_at!, hours));
  const speedSummary = (values: number[]) => ({ median: median(values), p90: percentile(values, 0.9), sample: values.length });

  const spend = input.spend.filter((row) => datesMatch(row.date) && matches(filters.campaign, row.campaign_id, row.campaign_name) && matches(filters.adset, row.adset_id, row.adset_name) && matches(filters.ad, row.ad_id, row.ad_name));
  const groupMaps = { campaign: new Map<string, AdsRow>(), adset: new Map<string, AdsRow>(), ad: new Map<string, AdsRow>() };
  const ensure = (level: keyof typeof groupMaps, group: Group) => {
    if (!groupMaps[level].has(group.key)) groupMaps[level].set(group.key, { ...group, spend: null, enquiries: 0, suitable: 0, call_booked: 0, demo: 0, quote: 0, won: 0, won_value: 0, cost_per_enquiry: null, cost_per_suitable: null, cost_per_demo: null, cost_per_customer: null });
    return groupMaps[level].get(group.key)!;
  };
  for (const row of spend) {
    const grouping = { campaign: { key: row.campaign_id || `name:${row.campaign_name}`, name: row.campaign_name || 'Unnamed campaign' }, adset: { key: row.adset_id || `name:${row.campaign_id}:${row.adset_name}`, name: row.adset_name || 'Unnamed ad set' }, ad: { key: row.ad_id, name: row.ad_name || row.ad_id } };
    for (const level of ['campaign', 'adset', 'ad'] as const) { const group = ensure(level, grouping[level]); group.spend = moneySum([group.spend, row.spend]); }
  }
  const matchCounts = { ad: 0, campaign: 0, unmatched: 0 };
  for (const deal of deals) {
    const match = resolveAdAttribution(attribution.get(deal.id), spend); matchCounts[match.method]++;
    for (const level of ['campaign', 'adset', 'ad'] as const) {
      const row = ensure(level, match[level]); row.enquiries++;
      for (const stage of ['suitable', 'call_booked', 'demo', 'quote', 'won'] as const) if (reached.get(deal.id)?.has(stage)) row[stage]++;
      if (deal.outcome === 'won') row.won_value = moneySum([row.won_value, deal.value_once]);
    }
  }
  for (const map of Object.values(groupMaps)) for (const row of map.values()) {
    row.cost_per_enquiry = row.spend != null && row.enquiries ? row.spend / row.enquiries : null;
    row.cost_per_suitable = row.spend != null && row.suitable ? row.spend / row.suitable : null;
    row.cost_per_demo = row.spend != null && row.demo ? row.spend / row.demo : null;
    row.cost_per_customer = row.spend != null && row.won ? row.spend / row.won : null;
  }
  const minutes = deals.reduce((sum, deal) => sum + Number(deal.presales_minutes ?? 0) + Number(deal.demo_build_minutes ?? 0), 0), won = deals.filter((deal) => deal.outcome === 'won').length, suitable = stageCount('suitable');
  const open = deals.filter((deal) => deal.outcome === 'open');
  const pipeline = stages.map((stage) => { const records = open.filter((deal) => deal.stage_key === stage.key); return { ...stage, count: records.length, value_once: records.some((deal) => deal.value_once != null) ? moneySum(records.map((deal) => deal.value_once)) : null, stale: records.filter((deal) => now.getTime() - new Date(deal.stage_entered_at || deal.created_at).getTime() > 14 * 86400_000).length }; });
  const winBySource = distinct(deals.map((deal) => deal.channel)).map((source) => { const closed = deals.filter((deal) => deal.channel === source && deal.outcome !== 'open'), successes = closed.filter((deal) => deal.outcome === 'won').length; return { source, won: successes, closed: closed.length, rate: closed.length ? successes / closed.length : null }; });
  const active = input.subscriptions.filter((subscription) => subscription.status === 'active'), today = formatInTimeZone(now, 'Australia/Adelaide', 'yyyy-MM-dd');
  const unpaid = input.invoices.filter((invoice) => ['sent', 'part_paid'].includes(invoice.status));
  const balance = (invoice: ReportInvoice) => Math.max(0, moneySum([invoice.total]) - moneySum(input.payments.filter((payment) => payment.invoice_id === invoice.id).map((payment) => payment.amount)));
  const overdue = unpaid.filter((invoice) => invoice.due_on < today);
  const firstProduct = input.products?.find((product) => product.kind === 'once');
  const qualifiedMinutes = suitable ? minutes / suitable : null;
  return {
    as_of: now.toISOString(), sample: deals.length, filters,
    options: { sources: distinct(validDeals.map((deal) => deal.channel)), campaigns: distinct([...input.attribution.flatMap((row) => [row.meta_campaign_name, row.utm_campaign]), ...input.spend.map((row) => row.campaign_name)]), adsets: distinct([...input.attribution.flatMap((row) => [row.meta_adset_name, row.utm_term]), ...input.spend.map((row) => row.adset_name)]), ads: distinct([...input.attribution.flatMap((row) => [row.meta_ad_name, row.utm_content]), ...input.spend.map((row) => row.ad_name)]), trades: distinct(input.businesses.map((row) => row.trade)) },
    funnel, cohorts: [...cohorts.values()].sort((a, b) => b.key.localeCompare(a.key)),
    speed: { first_touch: speedSummary(first), two_way: speedSummary(twoWay), within_target: countRate(first.filter((minutes) => minutes <= targetMinutes).length, first.length), target_minutes: targetMinutes, awaiting_first_touch: deals.length - first.length },
    ads: { campaign: [...groupMaps.campaign.values()], adset: [...groupMaps.adset.values()], ad: [...groupMaps.ad.values()], matched_by_ad: matchCounts.ad, matched_by_campaign: matchCounts.campaign, unmatched: matchCounts.unmatched, note: 'Spend covers the selected ads and dates. Source and trade filters narrow enquiry outcomes only. Campaign-only matches are kept separate at ad and ad set level; their spend is not guessed.' },
    presales: { minutes, won, minutes_per_customer: won ? minutes / won : null, minutes_per_qualified: qualifiedMinutes },
    pipeline: { stages: pipeline, win_by_source: winBySource },
    clients: { mrr: active.length ? moneySum(active.map((subscription) => subscription.price)) : null, active: active.length, paused: input.subscriptions.filter((subscription) => subscription.status === 'paused').length, cancelled_in_period: input.subscriptions.filter((subscription) => subscription.cancelled_on && datesMatch(subscription.cancelled_on)).length, outstanding: unpaid.length ? moneySum(unpaid.map(balance)) : null, overdue: overdue.length ? moneySum(overdue.map(balance)) : null, invoice_count: unpaid.length, scope: 'Current client portfolio. Enquiry filters do not change MRR or invoice balances. Churn is shown as cancellations; a rate needs historical subscription statuses.' },
    calculator_defaults: { revenue: firstProduct ? Number(firstProduct.price) : median(deals.map((deal) => Number(deal.value_once)).filter((value) => value > 0)), presales_minutes: qualifiedMinutes },
  };
}
