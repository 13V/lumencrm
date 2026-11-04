import { z } from 'zod';
import { apiError, HttpError, requireSession } from '@/lib/server/auth';
import { allRows } from '@/lib/server/jobs/shared';
import { buildReport, type ReportInput, type ReportFilters } from '@/lib/domain/report-view';
import { DEFAULT_WORKING_HOURS } from '@/lib/domain/time';

export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    const { db } = await requireSession(['owner', 'viewer']);
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const text = z.string().trim().max(300).optional(), date = z.iso.date().optional();
    const parsed = z.object({ source: text, campaign: text, adset: text, ad: text, trade: text, from: date, to: date, cohort: z.enum(['week', 'month']).optional() }).strict().safeParse(params);
    if (!parsed.success) return Response.json({ error: 'Check the report filters.', fields: parsed.error.flatten().fieldErrors }, { status: 400 });
    const filters: ReportFilters = parsed.data;
    if (filters.from && filters.to && filters.from > filters.to) throw new HttpError(400, 'The end date must follow the start date.');
    const read = <T,>(table: string, columns: string, deleted = false) => allRows<T>((from, to) => { let query = db.from(table).select(columns); if (deleted) query = query.is('deleted_at', null); return query.order('id').range(from, to); });
    const [deals, attribution, milestones, spend, businesses, subscriptions, invoices, payments, products, configuration] = await Promise.all([
      read<ReportInput['deals'][number]>('deals', 'id,business_id,channel,stage_key,stage_entered_at,outcome,created_at,closed_at,first_touch_at,two_way_at,value_once,value_monthly,presales_minutes,demo_build_minutes,deleted_at,anonymised_at,merged_into_id'),
      read<ReportInput['attribution'][number]>('attribution', 'deal_id,utm_campaign,utm_term,utm_content,meta_campaign_id,meta_campaign_name,meta_adset_id,meta_adset_name,meta_ad_id,meta_ad_name'),
      read<ReportInput['milestones'][number]>('deal_milestones', 'deal_id,milestone_key,first_reached_at'),
      read<ReportInput['spend'][number]>('ad_spend_daily', 'date,campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend'),
      read<ReportInput['businesses'][number]>('businesses', 'id,trade'),
      read<ReportInput['subscriptions'][number]>('subscriptions', 'id,price,status,started_on,cancelled_on', true),
      read<ReportInput['invoices'][number]>('invoices', 'id,total,status,due_on', true),
      read<ReportInput['payments'][number]>('payments', 'invoice_id,amount', true),
      read<NonNullable<ReportInput['products']>[number]>('products', 'name,kind,price', true),
      db.rpc('get_configuration'),
    ]);
    if (configuration.error) throw new HttpError(503, 'Report settings could not be loaded.');
    const config = configuration.data || {};
    return Response.json(buildReport({ deals, attribution, milestones, spend, businesses, subscriptions, invoices, payments, products }, filters, new Date(), { ...DEFAULT_WORKING_HOURS, ...config.call_hours }, config.speed_to_lead_minutes ?? 5, config.sales_stages), { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) { return apiError(error); }
}
