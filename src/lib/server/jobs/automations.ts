import 'server-only';
import { addWorkingDays, workingMinutesBetween, formatMoney } from '@/lib/domain';
import { allRows, localClock, queueNotification, runClaimed, ruleNumber, type JobContext } from './shared';
import { formatInTimeZone } from 'date-fns-tz';

async function task(context: JobContext, input: Record<string, unknown>) { const result = await context.db.rpc('ensure_task', { p_input: input }); if (result.error) throw new Error('automation_task_failed'); }
export async function entityAutomations(context: JobContext): Promise<number> {
  const records = await context.db.from('job_runs').select('key,kind,entity_id').in('kind', ['stage_automation', 'new_lead', 'human_reply', 'quote_accepted', 'project_launched']).or(`status.in.(pending,failed),and(status.eq.running,locked_at.lt.${new Date(context.now.getTime() - 10 * 60_000).toISOString()})`).lte('run_at', context.now.toISOString()).order('created_at').limit(100);
  if (records.error) throw new Error('automation_read_failed');
  let done = 0;
  for (const record of records.data ?? []) {
    const result = await runClaimed(context, record.key, record.kind, async () => {
      if (record.kind === 'new_lead') { if (context.enabled.has('new_lead')) await queueNotification(context, `new_lead:${record.entity_id}`, record.entity_id); return 1; }
      // Ingest already queues the Telegram alert for this reply. Add only its push event.
      if (record.kind === 'human_reply') { await queueNotification(context, record.key, record.entity_id, ['push']); return 1; }
      if (record.kind === 'quote_accepted') {
        const quote = await context.db.from('quotes').select('deal_id,status,deleted_at').eq('id', record.entity_id).single();
        if (quote.error) throw new Error('accepted_quote_read_failed');
        if (!quote.data || quote.data.deleted_at || quote.data.status !== 'accepted') return 0;
        // Reuse the transaction's event key and deal link; entity_id here is the quote id.
        await queueNotification(context, record.key, quote.data.deal_id); return 1;
      }
      if (record.kind === 'project_launched') return 0; // The transactional launch RPC creates subscription/checklist work.
      const stage = String(record.key).split(':').at(-1);
      if (!stage || !record.entity_id) return 0;
      // Acceptance has its own durable event. A stage change alone is not a quote acceptance.
      if (stage === 'won') return 0;
      const [deal, milestone] = await Promise.all([
        context.db.from('deals').select('id,contact_id,outcome,deleted_at').eq('id', record.entity_id).single(),
        context.db.from('deal_milestones').select('first_reached_at').eq('deal_id', record.entity_id).eq('milestone_key', stage).maybeSingle(),
      ]);
      if (deal.error || milestone.error) throw new Error('stage_read_failed');
      if (!deal.data || deal.data.deleted_at || !milestone.data) return 0;
      if (deal.data.outcome !== 'open') return 0;
      const configuredQuoteDays = context.rules?.quote_sent?.working_days;
      const quoteDays = Array.isArray(configuredQuoteDays) && configuredQuoteDays.every((day) => Number.isInteger(day) && Number(day) > 0) ? configuredQuoteDays as number[] : [2, 7];
      const days = stage === 'demo' && context.enabled.has('demo_sent') ? [ruleNumber(context, 'demo_sent', 'working_days', 2)] : stage === 'quote' && context.enabled.has('quote_sent') ? quoteDays : [];
      for (const day of days) {
        const due = addWorkingDays(milestone.data.first_reached_at, day, context.settings.call_hours);
        await task(context, { deal_id: record.entity_id, contact_id: deal.data.contact_id, title: stage === 'demo' ? 'Follow up the homepage demo' : 'Follow up the quote', due_at: due, rule_key: `${stage}_followup_${day}` });
      }
      return days.length;
    }, record.entity_id);
    if (result.status === 'done') done += result.count;
  }
  return done;
}

export async function reviewOpenLeads(context: JobContext): Promise<number> {
  const deals = await allRows<{ id: string; contact_id: string; two_way_at: string | null; promised_due_at: string | null; stage_key: string }>((from, to) => context.db.from('deals').select('id,contact_id,two_way_at,promised_due_at,stage_key').eq('outcome', 'open').is('deleted_at', null).order('id').range(from, to));
  let count = 0;
  for (const deal of deals) {
    if (context.enabled.has('no_answer') && !deal.two_way_at) {
      const calls = await context.db.from('activities').select('occurred_at').eq('deal_id', deal.id).eq('type', 'call').in('outcome', ['no_answer', 'voicemail', 'busy']).is('deleted_at', null).order('occurred_at').limit(100);
      if (calls.error) throw new Error('attempts_read_failed');
      const first = calls.data?.[0]?.occurred_at;
      const [startH, startM] = context.settings.call_hours.start.split(':').map(Number), [endH, endM] = context.settings.call_hours.end.split(':').map(Number);
      const attempts = ruleNumber(context, 'no_answer', 'attempts', 3), days = ruleNumber(context, 'no_answer', 'working_days', 5);
      if ((calls.data?.length ?? 0) >= attempts && first && workingMinutesBetween(first, context.now, context.settings.call_hours) >= days * ((endH - startH) * 60 + endM - startM)) {
        await task(context, { deal_id: deal.id, contact_id: deal.contact_id, title: 'Review no reply outcome', notes: `At least ${attempts} attempts across ${days} working days without two-way contact. Decide whether to keep following up or mark No reply.`, due_at: context.now.toISOString(), rule_key: 'no_answer_review' }); count++;
      }
    }
    if (context.enabled.has('promise_date') && deal.promised_due_at && !['demo', 'quote', 'won'].includes(deal.stage_key)) {
      const nextDay = formatInTimeZone(addWorkingDays(context.now, 1, context.settings.call_hours), 'Australia/Adelaide', 'yyyy-MM-dd');
      if (formatInTimeZone(deal.promised_due_at, 'Australia/Adelaide', 'yyyy-MM-dd') === nextDay) {
        await task(context, { deal_id: deal.id, contact_id: deal.contact_id, title: 'Promise at risk: prepare demo and quote', due_at: context.now.toISOString(), priority: 'high', rule_key: 'promise_risk' }); count++;
      }
    }
  }
  if (context.enabled.has('lost_check_in')) {
    const closed = await allRows<{ id: string; contact_id: string; closed_at: string }>((from, to) => context.db.from('deals').select('id,contact_id,closed_at').in('outcome', ['lost', 'noreply']).is('deleted_at', null).not('closed_at', 'is', null).order('id').range(from, to));
    for (const deal of closed) {
      const due = new Date(deal.closed_at); due.setUTCDate(due.getUTCDate() + ruleNumber(context, 'lost_check_in', 'days', 90));
      await task(context, { deal_id: deal.id, contact_id: deal.contact_id, title: 'Consider a check-in', notes: 'Review consent and the earlier outcome before deciding to contact them.', due_at: due.toISOString(), rule_key: 'lost_check_in' }); count++;
    }
  }
  return count;
}

export async function expireQuotes(context: JobContext): Promise<number> {
  const expired = await context.db.from('quotes').update({ status: 'expired' }).in('status', ['sent', 'viewed']).is('deleted_at', null).lt('expires_at', context.now.toISOString()).select('id');
  if (expired.error) throw new Error('quote_expiry_failed');
  return expired.data?.length ?? 0;
}
export function nextBillingDate(period: string, billingDay: number): string {
  const date = new Date(`${period}T12:00:00Z`); date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + 1); date.setUTCDate(Math.max(1, Math.min(28, billingDay)));
  return date.toISOString().slice(0, 10);
}
export async function draftSubscriptionInvoices(context: JobContext): Promise<number> {
  if (!context.enabled.has('billing_day')) return 0;
  const subscriptions = await context.db.from('subscriptions').select('id,business_id,product_id,price,billing_day,next_invoice_on').eq('status', 'active').is('deleted_at', null).lte('next_invoice_on', localClock(context.now).day).order('next_invoice_on').limit(100);
  if (subscriptions.error) throw new Error('subscriptions_read_failed');
  let count = 0;
  for (const subscription of subscriptions.data ?? []) {
    const period = subscription.next_invoice_on;
    const result = await runClaimed(context, `subscription_invoice:${subscription.id}:${period}`, 'subscription_invoice', async () => {
      const existing = await context.db.from('invoices').select('id').eq('subscription_id', subscription.id).eq('issued_on', period).neq('status', 'void').is('deleted_at', null).maybeSingle();
      if (existing.error) throw new Error('invoice_lookup_failed');
      if (!existing.data) {
        const [contact, product] = await Promise.all([
          context.db.from('contacts').select('id').eq('business_id', subscription.business_id).is('deleted_at', null).limit(1).maybeSingle(),
          subscription.product_id ? context.db.from('products').select('name').eq('id', subscription.product_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
        ]);
        if (contact.error || product.error) throw new Error('billing_details_failed');
        const due = new Date(`${period}T12:00:00Z`); due.setUTCDate(due.getUTCDate() + (context.settings.invoices?.payment_terms_days ?? 14));
        const invoice = await context.db.rpc('create_invoice', { p_input: { business_id: subscription.business_id, contact_id: contact.data?.id, subscription_id: subscription.id, issued_on: period, due_on: due.toISOString().slice(0, 10), items: [{ product_id: subscription.product_id, description: product.data?.name || 'Subscription service', qty: 1, unit_price: Number(subscription.price), included: false }] } });
        if (invoice.error) throw new Error('subscription_invoice_failed');
      }
      const advanced = await context.db.from('subscriptions').update({ next_invoice_on: nextBillingDate(period, subscription.billing_day) }).eq('id', subscription.id).eq('next_invoice_on', period);
      if (advanced.error) throw new Error('subscription_advance_failed');
      return 1;
    }, subscription.id);
    if (result.status === 'done') count += result.count;
  }
  return count;
}
export async function draftOverdueReminders(context: JobContext): Promise<number> {
  if (!context.enabled.has('invoice_overdue')) return 0;
  const invoices = await context.db.from('invoices').select('id,number,contact_id,deal_id,total,due_on').in('status', ['sent', 'part_paid']).is('deleted_at', null).lt('due_on', localClock(context.now).day).order('due_on').limit(200);
  if (invoices.error) throw new Error('overdue_read_failed');
  let count = 0;
  for (const invoice of invoices.data ?? []) {
    await task(context, { deal_id: invoice.deal_id, contact_id: invoice.contact_id, title: `Review overdue invoice ${invoice.number}`, due_at: context.now.toISOString(), rule_key: `invoice_overdue:${invoice.id}`, priority: 'high' });
    if (invoice.contact_id) {
      const payments = await context.db.from('payments').select('amount').eq('invoice_id', invoice.id).is('deleted_at', null);
      if (payments.error) throw new Error('payments_read_failed');
      const balance = Math.max(0, Number(invoice.total) - (payments.data ?? []).reduce((sum, payment) => sum + Number(payment.amount), 0));
      const draft = await context.db.from('message_drafts').upsert({ contact_id: invoice.contact_id, deal_id: invoice.deal_id, invoice_id: invoice.id, channel: 'email', subject: `Invoice ${invoice.number}`, body: `Hi, a quick reminder that invoice ${invoice.number} for ${formatMoney(balance)} was due on ${formatInTimeZone(`${invoice.due_on}T12:00:00Z`, 'Australia/Adelaide', 'EEE d MMM')}. Let me know if anything's unclear. Thanks, Troy, Lumen adl`, rule_key: `invoice_overdue:${invoice.id}`, status: 'draft' }, { onConflict: 'rule_key', ignoreDuplicates: true });
      if (draft.error) throw new Error('reminder_draft_failed');
    }
    count++;
  }
  return count;
}
