import 'server-only';
import { requireSession, HttpError } from './auth';
import type { CrmData } from '@/lib/types';
import type { Database } from '@/lib/database.types';
import { allRows } from './jobs/shared';

export async function loadCrm(session?: Awaited<ReturnType<typeof requireSession>>, detailId?: string): Promise<CrmData> {
  const { db, user, profile } = session ?? await requireSession();
  const tables = ['contacts', 'businesses', 'deals', 'tasks', 'appointments', 'activities', 'profiles', 'attribution'] as const;
  const results = await Promise.all(tables.map(table => {
    let query = db.from(table).select('*').limit(table === 'activities' ? 500 : 250);
    if (!['attribution', 'profiles'].includes(table)) query = query.is('deleted_at', null);
    return query.order(table === 'activities' ? 'occurred_at' : 'created_at', { ascending: false });
  }));
  if (results.some(result => result.error)) throw new HttpError(503, 'Your workspace could not be loaded. Check the database migrations and access policies.');
  const records = Object.fromEntries(tables.map((name, index) => [name, results[index].data || []]));
  // The lead list is paginated, but actionable older work must never disappear from Today.
  const [openDeals, pendingTasks, bookedAppointments] = await Promise.all([
    allRows<Database['public']['Tables']['deals']['Row']>((from, to) => db.from('deals').select('*').eq('outcome', 'open').is('deleted_at', null).order('id').range(from, to)),
    allRows<Database['public']['Tables']['tasks']['Row']>((from, to) => db.from('tasks').select('*').is('done_at', null).is('deleted_at', null).order('id').range(from, to)),
    allRows<Database['public']['Tables']['appointments']['Row']>((from, to) => db.from('appointments').select('*').eq('status', 'booked').is('deleted_at', null).order('id').range(from, to)),
  ]);
  for (const [key, rows] of [['deals', openDeals], ['tasks', pendingTasks], ['appointments', bookedAppointments]] as const) records[key] = [...new Map([...records[key], ...rows].map(row => [row.id, row])).values()];
  // A pending task or booking can belong to an older closed deal.
  const actionableDealIds = [...new Set([...pendingTasks, ...bookedAppointments].map(row => row.deal_id).filter(Boolean))].filter(id => !records.deals.some(deal => deal.id === id));
  for (let offset = 0; offset < actionableDealIds.length; offset += 100) {
    const result = await db.from('deals').select('*').in('id', actionableDealIds.slice(offset, offset + 100)).is('deleted_at', null);
    if (result.error) throw new HttpError(503, 'Related follow-up details could not be loaded.');
    records.deals.push(...(result.data || []));
  }
  if (detailId) {
    const [deal, activity, tasks, appointments, attribution] = await Promise.all([
      db.from('deals').select('*').eq('id', detailId).is('deleted_at', null).maybeSingle(),
      db.from('activities').select('*').eq('deal_id', detailId).is('deleted_at', null).order('occurred_at', { ascending: false }).limit(500),
      db.from('tasks').select('*').eq('deal_id', detailId).is('deleted_at', null).limit(250),
      db.from('appointments').select('*').eq('deal_id', detailId).is('deleted_at', null).limit(250),
      db.from('attribution').select('*').eq('deal_id', detailId).limit(1),
    ]);
    if ([deal, activity, tasks, appointments, attribution].some(r => r.error)) throw new HttpError(503, 'Lead details could not be loaded.');
    if (deal.data && !records.deals.some(d => d.id === detailId)) records.deals.push(deal.data);
    for (const [key, rows] of [['activities', activity.data], ['tasks', tasks.data], ['appointments', appointments.data], ['attribution', attribution.data]] as const) records[key] = [...new Map([...records[key], ...(rows || [])].map(row => [row.id, row])).values()];
  }
  // Related contacts can be much older than their newest deal; do not lose them at page boundaries.
  const contactIds = [...new Set([...records.deals.map(d => d.contact_id), ...pendingTasks.map(task => task.contact_id), ...bookedAppointments.map(call => call.contact_id)].filter(Boolean))].filter(id => !records.contacts.some(c => c.id === id));
  const businessIds = [...new Set(records.deals.map(d => d.business_id).filter(Boolean))].filter(id => !records.businesses.some(b => b.id === id));
  await Promise.all((['contacts', 'businesses'] as const).map(async table => {
    const ids = table === 'contacts' ? contactIds : businessIds;
    for (let offset = 0; offset < ids.length; offset += 100) {
      const result = await db.from(table).select('*').in('id', ids.slice(offset, offset + 100)).is('deleted_at', null);
      if (result.error) throw new HttpError(503, 'Contact details could not be loaded.');
      records[table].push(...(result.data || []));
    }
  }));
  const missingAttribution = records.deals.map(d => d.id).filter(id => !records.attribution.some(a => a.deal_id === id));
  for (let offset = 0; offset < missingAttribution.length; offset += 100) {
    const result = await db.from('attribution').select('*').in('deal_id', missingAttribution.slice(offset, offset + 100));
    if (result.error) throw new HttpError(503, 'Lead sources could not be loaded.');
    records.attribution.push(...(result.data || []));
  }
  const config = await db.rpc('get_configuration');
  if (config.error) throw new HttpError(503, 'Workspace settings could not be loaded.');
  return { ...records, config: { ...(config.data || {}), integrations: { chloe_enabled: Boolean(process.env.CHLOE_TAKEOVER_URL), sms_enabled: Boolean(process.env.CLICKSEND_API_KEY), email_enabled: Boolean(process.env.RESEND_API_KEY) } }, user: { id: user.id, name: profile.name, email: user.email } } as unknown as CrmData;
}
