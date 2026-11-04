'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, Clock3, Filter, RefreshCw } from 'lucide-react';
import { Button, Field } from './ui';
import type { CrmData, CrmMode, Role } from '@/lib/types';
import { buildReport, type ReportInput, type ReportFilters, type ReportView, type AdsRow } from '@/lib/domain/report-view';
import { acquisitionRange, formatMoney } from '@/lib/domain';
import { formatInTimeZone } from 'date-fns-tz';
import './reports.css';

const number = (value: number) => new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 }).format(value);
const money = (value: number | null) => value == null ? 'none yet' : formatMoney(value);
const minutes = (value: number | null) => value == null ? 'none yet' : Math.round(value) < 60 ? `${Math.round(value)} min` : `${Math.floor(Math.round(value) / 60)}h ${Math.round(value) % 60}m`;
const rate = (count: number, denominator: number) => denominator ? `${Math.round(count / denominator * 100)}%` : 'none yet';

// This is a fictional event history, separate from the current-stage field.
const DEMO_HISTORY: Record<string, string[]> = {
  'demo-04': ['contacted', 'suitable', 'call_booked'], 'demo-05': ['contacted', 'suitable', 'call_booked'],
  'demo-06': ['contacted', 'suitable', 'call_booked', 'brief'], 'demo-07': ['contacted', 'suitable', 'brief', 'demo'],
  'demo-08': ['contacted', 'suitable', 'brief', 'demo', 'quote'], 'demo-09': ['contacted'], 'demo-10': ['contacted', 'suitable'],
  'demo-11': ['contacted', 'suitable', 'brief', 'demo', 'quote'], 'demo-12': ['contacted', 'suitable', 'brief'], 'demo-13': ['contacted'],
  'demo-14': ['contacted', 'suitable'], 'demo-15': ['contacted', 'suitable', 'brief', 'demo'],
  'demo-16': ['contacted', 'suitable', 'call_booked', 'brief', 'demo', 'quote', 'won'], 'demo-17': ['contacted'],
  'demo-18': ['contacted', 'suitable', 'call_booked', 'brief', 'demo', 'quote', 'won'], 'demo-19': ['contacted', 'suitable', 'brief'],
  'demo-20': ['contacted', 'suitable', 'brief', 'demo', 'quote'], 'demo-21': ['contacted', 'suitable'], 'demo-22': ['contacted'],
  'demo-23': ['contacted', 'suitable', 'call_booked', 'brief', 'demo', 'quote', 'won'], 'demo-24': ['contacted', 'suitable', 'brief'],
  'demo-25': ['contacted', 'suitable', 'brief', 'demo'], 'demo-26': ['contacted'],
  'demo-27': ['contacted', 'suitable', 'call_booked', 'brief', 'demo', 'quote', 'won'], 'demo-28': ['contacted', 'suitable'],
  'demo-29': ['contacted', 'suitable', 'brief', 'demo', 'quote'], 'demo-30': ['contacted'],
};
function demoReportInput(data: CrmData): ReportInput {
  const today = formatInTimeZone(new Date(), 'Australia/Adelaide', 'yyyy-MM-dd');
  return {
    deals: data.deals, businesses: data.businesses, attribution: data.attribution,
    milestones: data.deals.flatMap((deal) => (DEMO_HISTORY[deal.id] ?? []).map((key, index) => ({ deal_id: deal.id, milestone_key: key, first_reached_at: new Date(new Date(deal.created_at).getTime() + (index + 1) * 20 * 60_000).toISOString() }))),
    spend: [{ date: today, campaign_id: 'fictional-campaign', campaign_name: 'Adelaide trades · Spring', adset_id: 'fictional-adset', adset_name: 'Adelaide local trades', ad_id: 'fictional-ad', ad_name: 'Your work deserves a better website', spend: 300 }],
    subscriptions: ['demo-16', 'demo-18'].flatMap((id) => { const deal = data.deals.find((item) => item.id === id); return deal?.value_monthly ? [{ id: `subscription-${id}`, price: deal.value_monthly, status: 'active', started_on: today, cancelled_on: null }] : []; }),
    invoices: [], payments: [], products: [],
  };
}
function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) { return <div className="report-metric"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>; }
function EmptyTable({ text = 'No records match these filters.' }: { text?: string }) { return <p className="report-empty">{text}</p>; }
function Cost({ row, value, count }: { row: AdsRow; value: number | null; count: number }) { return <>{row.spend == null ? <span className="muted">Not matched</span> : !count ? <span className="muted">none yet <small>({money(row.spend)} spent)</small></span> : money(value)}</>; }

export function ReportsWorkspace({ crmData, mode, role }: { crmData: CrmData; mode: CrmMode; role: Role }) {
  const [filters, setFilters] = useState<ReportFilters>({ cohort: 'month' }), [showFilters, setShowFilters] = useState(false);
  const [report, setReport] = useState<ReportView | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0);
  const [adLevel, setAdLevel] = useState<'campaign' | 'adset' | 'ad'>('campaign');
  useEffect(() => {
    if (role === 'staff') return;
    if (mode === 'demo') { setReport(buildReport(demoReportInput(crmData), filters)); setLoading(false); return; }
    const controller = new AbortController(); setLoading(true); setError('');
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => Boolean(value)) as [string, string][]);
    fetch(`/api/reports?${query}`, { signal: controller.signal, cache: 'no-store' }).then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Reports could not be loaded.'); return result as ReportView; }).then(setReport).catch((cause) => { if (cause.name !== 'AbortError') setError(cause.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [crmData, filters, mode, refresh, role]);
  if (role === 'staff') return <p className="report-empty">Reports are available to the owner and viewers.</p>;
  const update = (key: keyof ReportFilters, value: string) => setFilters((old) => ({ ...old, [key]: value || undefined }));
  const filtered = Object.entries(filters).filter(([key, value]) => key !== 'cohort' && value).length;
  return <div className="reports-workspace">
    <header className="page-heading"><div><p className="report-eyebrow">UNDERSTAND THE BUSINESS</p><h1>Reports</h1><p className="page-description">What’s working, what it costs, and where your time goes.</p></div><div className="row"><Button variant="outline" onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters}><Filter size={16} />Filters{filtered ? ` · ${filtered}` : ''}</Button><Button variant="ghost" size="icon" aria-label="Refresh reports" onClick={() => setRefresh((old) => old + 1)}><RefreshCw size={17} /></Button></div></header>
    {mode === 'demo' && <p className="report-notice">Fictional preview. These numbers include an explicit sample event history and sample ad spend.</p>}
    {showFilters && <section className="report-filters" aria-label="Report filters">
      {(['source', 'campaign', 'adset', 'ad', 'trade'] as const).map((key) => { const optionKey = ({ source: 'sources', campaign: 'campaigns', adset: 'adsets', ad: 'ads', trade: 'trades' } as const)[key]; return <Field key={key} label={key === 'adset' ? 'Ad set' : key[0].toUpperCase() + key.slice(1)}><select value={filters[key] || ''} onChange={(event) => update(key, event.target.value)}><option value="">All</option>{report?.options[optionKey].map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></Field>; })}
      <Field label="Enquiries from"><input type="date" value={filters.from || ''} onChange={(event) => update('from', event.target.value)} /></Field><Field label="To, inclusive"><input type="date" value={filters.to || ''} onChange={(event) => update('to', event.target.value)} /></Field><Button variant="ghost" onClick={() => setFilters({ cohort: filters.cohort })}>Clear filters</Button>
    </section>}
    {error && <div role="alert" className="report-notice error-text">{error}<Button variant="ghost" onClick={() => setRefresh((old) => old + 1)}>Try again</Button></div>}
    {!report && loading ? <div className="report-skeleton" aria-label="Loading reports" aria-busy="true">{[1, 2, 3, 4].map((i) => <div key={i} />)}</div> : report && <div aria-busy={loading} className={loading ? 'report-refreshing' : ''}>
      <div className="report-overview"><Metric label="Enquiries" value={number(report.sample)} detail="In the selected enquiry cohort" /><Metric label="Customers won" value={number(report.presales.won)} detail={`${report.sample} enquiries in this sample`} /><Metric label="Time per customer won" value={minutes(report.presales.minutes_per_customer)} detail={`${minutes(report.presales.minutes)} total presales and demo time`} /><Metric label="Hosting MRR" value={money(report.clients.mrr)} detail={`${report.clients.active} active subscriptions · revenue, not profit`} /></div>
      <div className="report-two-col">
        <section className="report-panel"><div className="report-section-heading"><div><h2>From enquiry to client</h2><p>First-reached milestones. Share of all {report.sample} enquiries.</p></div><ArrowDownRight size={19} /></div><div className="report-funnel">{report.funnel.map((stage) => <div className="report-funnel-row" key={stage.key}><span>{stage.label}</span><div aria-hidden="true" className="report-bar"><i style={{ width: `${(stage.rate ?? 0) * 100}%` }} /></div><strong>{stage.count}</strong><small>{stage.rate == null ? 'none yet' : `${rate(stage.count, stage.denominator)} (${stage.count}/${stage.denominator})`}</small></div>)}</div></section>
        <section className="report-panel"><div className="report-section-heading"><div><h2>Speed to lead</h2><p>Working minutes, in Adelaide. Closed hours and holidays excluded.</p></div><Clock3 size={18} /></div><div className="report-speed"><Metric label="Median first attempt" value={minutes(report.speed.first_touch.median)} detail={`90th percentile: ${minutes(report.speed.first_touch.p90)} · n=${report.speed.first_touch.sample}`} /><Metric label="Median two-way contact" value={minutes(report.speed.two_way.median)} detail={`90th percentile: ${minutes(report.speed.two_way.p90)} · n=${report.speed.two_way.sample}`} /></div><div className="report-target"><strong>{rate(report.speed.within_target.count, report.speed.within_target.denominator)}</strong><span>Within {report.speed.target_minutes} working minutes<small>{report.speed.within_target.count}/{report.speed.within_target.denominator} attempted enquiries. {report.speed.awaiting_first_touch} still awaiting an attempt.</small></span></div></section>
      </div>
      <section className="report-panel"><div className="report-section-heading"><div><h2>Ads to revenue</h2><p>Spend alongside the outcomes it can actually be matched to.</p></div><label className="report-inline-select"><span className="sr-only">Group ads by</span><select aria-label="Group ads by" value={adLevel} onChange={(event) => setAdLevel(event.target.value as typeof adLevel)}><option value="campaign">By campaign</option><option value="adset">By ad set</option><option value="ad">By ad</option></select></label></div>
        {report.ads[adLevel].length ? <div className="report-table-scroll" role="region" aria-label="Advertising outcomes table" tabIndex={0}><table><thead><tr><th scope="col">{adLevel === 'adset' ? 'Ad set' : adLevel === 'ad' ? 'Ad' : 'Campaign'}</th>{['Spend', 'Enquiries', 'Suitable', 'Calls', 'Demos', 'Quotes', 'Won', 'Won value', 'Cost / enquiry', 'Cost / suitable', 'Cost / demo', 'Cost / customer'].map((label) => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{report.ads[adLevel].map((row) => <tr key={row.key}><th scope="row">{row.name}</th><td>{row.spend == null ? 'Not matched' : money(row.spend)}</td><td>{row.enquiries}</td><td>{row.suitable}</td><td>{row.call_booked}</td><td>{row.demo}</td><td>{row.quote}</td><td>{row.won}</td><td>{row.won ? money(row.won_value) : 'none yet'}</td><td><Cost row={row} value={row.cost_per_enquiry} count={row.enquiries} /></td><td><Cost row={row} value={row.cost_per_suitable} count={row.suitable} /></td><td><Cost row={row} value={row.cost_per_demo} count={row.demo} /></td><td><Cost row={row} value={row.cost_per_customer} count={row.won} /></td></tr>)}</tbody></table></div> : <EmptyTable text="No ad spend or attributed enquiries yet. Connect the read-only Meta import in Settings." />}
        <p className="report-footnote">{report.ads.matched_by_ad} matched by ad · {report.ads.matched_by_campaign} by campaign only · {report.ads.unmatched} unmatched. {report.ads.note}</p>
      </section>
      <AcquisitionCalculator report={report} />
      <div className="report-two-col"><section className="report-panel"><div className="report-section-heading"><div><h2>Open pipeline</h2><p>One-off value. Stuck means more than 14 days in the current stage.</p></div></div><div className="report-table-scroll"><table><thead><tr><th scope="col">Stage</th><th scope="col">Deals</th><th scope="col">Value</th><th scope="col">Stuck</th></tr></thead><tbody>{report.pipeline.stages.map((stage) => <tr key={stage.key}><th scope="row">{stage.label}</th><td>{stage.count}</td><td>{money(stage.value_once)}</td><td>{stage.stale || '—'}</td></tr>)}</tbody></table></div></section><section className="report-panel"><div className="report-section-heading"><div><h2>Win rate by source</h2><p>Won divided by closed outcomes. Open enquiries are excluded.</p></div></div>{report.pipeline.win_by_source.length ? <div className="report-source-list">{report.pipeline.win_by_source.map((row) => <div key={row.source}><span>{row.source.replaceAll('_', ' ')}</span><strong>{rate(row.won, row.closed)} <small>({row.won}/{row.closed})</small></strong></div>)}</div> : <EmptyTable />}</section></div>
      <section className="report-panel"><div className="report-section-heading"><div><h2>Clients and cash</h2><p>Recurring revenue and outstanding invoices, kept separate.</p></div></div><div className="report-client-metrics"><Metric label="Monthly recurring revenue" value={money(report.clients.mrr)} detail={`${report.clients.active} active · ${report.clients.paused} paused`} /><Metric label="Cancelled subscriptions" value={number(report.clients.cancelled_in_period)} detail="Cancellations in the selected date period" /><Metric label="Outstanding invoices" value={money(report.clients.outstanding)} detail={`${report.clients.invoice_count} unpaid or part paid`} /><Metric label="Overdue balance" value={money(report.clients.overdue)} detail="After recorded part payments" /></div><p className="report-footnote">{report.clients.scope}</p></section>
      <section className="report-panel"><div className="report-section-heading"><div><h2>Enquiry cohorts</h2><p>Grouped by when the enquiry arrived, using its first milestone history.</p></div><label className="report-inline-select"><span className="sr-only">Cohort period</span><select value={filters.cohort} onChange={(event) => update('cohort', event.target.value)}><option value="month">By month</option><option value="week">By week</option></select></label></div>{report.cohorts.length ? <div className="report-table-scroll" tabIndex={0} role="region" aria-label="Enquiry cohort table"><table><thead><tr><th scope="col">{filters.cohort === 'week' ? 'Week starting' : 'Month'}</th><th scope="col">Enquiries</th>{report.funnel.slice(1).map((stage) => <th scope="col" key={stage.key}>{stage.label}</th>)}</tr></thead><tbody>{report.cohorts.map((cohort) => <tr key={cohort.key}><th scope="row">{cohort.key}</th><td>{cohort.enquiries}</td>{report.funnel.slice(1).map((stage) => <td key={stage.key}>{cohort.stages[stage.key] || 0} <small>({rate(cohort.stages[stage.key] || 0, cohort.enquiries)})</small></td>)}</tr>)}</tbody></table></div> : <EmptyTable />}</section>
    </div>}
  </div>;
}

function AcquisitionCalculator({ report }: { report: ReportView }) {
  const [values, setValues] = useState({ revenue: '', delivery: '', retained: '', hourly: '', minutes: '', low: '20', high: '40' });
  const effective = { ...values, revenue: values.revenue || (report.calculator_defaults.revenue == null ? '' : String(report.calculator_defaults.revenue)), minutes: values.minutes || (report.calculator_defaults.presales_minutes == null ? '' : String(Math.round(report.calculator_defaults.presales_minutes))) };
  const calculated = useMemo(() => {
    if (Object.values(effective).some((value) => value === '')) return null;
    try { return acquisitionRange({ project_revenue: Number(effective.revenue), delivery_costs: Number(effective.delivery), retained_contribution: Number(effective.retained), hourly_rate: Number(effective.hourly), presales_minutes_per_qualified_lead: Number(effective.minutes), close_rate_low: Number(effective.low) / 100, close_rate_high: Number(effective.high) / 100 }); } catch { return null; }
  }, [effective.revenue, effective.delivery, effective.retained, effective.hourly, effective.minutes, effective.low, effective.high]);
  return <section className="report-panel report-calculator"><div className="report-section-heading"><div><h2>What can you afford to acquire a client?</h2><p>Your contribution, your time and a range of close rates. Hosting is separate.</p></div><ArrowUpRight size={19} /></div><div className="report-calculator-layout"><div className="report-calculator-fields">{([
    ['revenue', 'Project revenue', '$'], ['delivery', 'Delivery costs', '$'], ['retained', 'Desired retained contribution', '$'], ['hourly', 'Your hourly rate', '$'], ['minutes', 'Presales minutes per qualified lead', 'min'], ['low', 'Qualified lead close rate · low', '%'], ['high', 'Qualified lead close rate · high', '%'],
  ] as const).map(([key, label, unit]) => <Field key={key} label={label}><div className="report-number-input"><span aria-hidden="true">{unit}</span><input aria-label={label} inputMode="decimal" type="number" min="0" max={unit === '%' ? 100 : undefined} step={unit === '%' || unit === 'min' ? 1 : 0.01} value={effective[key]} onChange={(event) => setValues((old) => ({ ...old, [key]: event.target.value }))} /></div></Field>)}<p className="report-footnote">The 20–40% close-rate range is a starting assumption, not a forecast. Sample presales includes time on lost enquiries.</p></div><div className="report-calculator-result" aria-live="polite">{calculated ? <><span>Maximum advertising CAC</span><strong>{money(calculated.low.advertising_cac)} – {money(calculated.high.advertising_cac)}</strong><p>Per customer acquired</p><div><span>Allowable cost per qualified lead</span><strong>{money(calculated.low.cost_per_qualified_lead)} – {money(calculated.high.cost_per_qualified_lead)}</strong></div><p>After delivery costs, your retained contribution and presales time at each close rate.</p>{calculated.low.advertising_cac < 0 && <p className="error-text">The lower close-rate scenario leaves no advertising allowance. Review price, costs or the time needed to win a client.</p>}</> : <><span>Build your range</span><strong>Add your assumptions</strong><p>Enter delivery costs, retained contribution and your hourly rate to calculate the advertising allowance.</p></>}</div></div></section>;
}
