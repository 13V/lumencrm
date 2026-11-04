import 'server-only';
import { fromZonedTime } from 'date-fns-tz';
import { sendTelegram, telegramReady } from '@/lib/server/providers';
import { workingMinutesBetween } from '@/lib/domain/time';
import { allRows, localClock, queueNotification, ruleNumber, type JobContext } from './shared';
import { deliverPush, ownerSubscriptions, pushReady } from './push';

type Notice = { id: string; event_key: string; entity_id: string | null; channel: string; status: string };
export function notificationCopy(key: string, entityId: string | null) {
  if (key.startsWith('call_reminder:')) return { text: 'A booked call starts soon. Your notes are ready in Lumen CRM.', path: '/calendar' };
  if (key.startsWith('speed:')) return { text: 'A new enquiry has passed your reply target. Open Lumen CRM to make contact.', path: entityId ? `/leads/${entityId}` : '/today' };
  if (key.startsWith('quote_accepted:')) return { text: 'A quote has been accepted. The project and next steps are ready in Lumen CRM.', path: entityId ? `/leads/${entityId}` : '/today' };
  if (key.startsWith('new_lead:')) return { text: 'A new enquiry is waiting in Lumen CRM.', path: entityId ? `/leads/${entityId}` : '/today' };
  if (key.startsWith('human_reply:') || key.startsWith('reply:')) return { text: 'A lead you are handling has replied. Open Lumen CRM to read the message.', path: entityId ? `/leads/${entityId}` : '/today' };
  return { text: 'An enquiry has an update in Lumen CRM.', path: entityId ? `/leads/${entityId}` : '/today' };
}
export async function digestText(context: JobContext): Promise<string> {
  const day = localClock(context.now).day;
  const start = fromZonedTime(`${day}T00:00:00`, 'Australia/Adelaide').toISOString();
  const tomorrow = new Date(`${day}T12:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const end = fromZonedTime(`${tomorrow.toISOString().slice(0, 10)}T00:00:00`, 'Australia/Adelaide').toISOString();
  const results = await Promise.all([
    context.db.from('appointments').select('id', { count: 'exact', head: true }).eq('status', 'booked').is('deleted_at', null).gte('starts_at', start).lt('starts_at', end),
    context.db.from('tasks').select('id', { count: 'exact', head: true }).is('done_at', null).is('deleted_at', null).lt('due_at', end),
    context.db.from('deals').select('id', { count: 'exact', head: true }).eq('outcome', 'open').is('deleted_at', null).gte('promised_due_at', start).lt('promised_due_at', end),
    context.db.from('invoices').select('id', { count: 'exact', head: true }).in('status', ['sent', 'part_paid']).is('deleted_at', null).lt('due_on', day),
  ]);
  if (results.some((result) => result.error)) throw new Error('digest_read_failed');
  const [calls, tasks, promises, invoices] = results.map((result) => result.count ?? 0);
  return `Today in Lumen CRM\n${calls} booked ${calls === 1 ? 'call' : 'calls'}\n${tasks} ${tasks === 1 ? 'task' : 'tasks'} due or overdue\n${promises} ${promises === 1 ? 'promise' : 'promises'} due today\n${invoices} overdue ${invoices === 1 ? 'invoice' : 'invoices'}`;
}
export async function queueReminders(context: JobContext): Promise<number> {
  let count = 0;
  if (context.enabled.has('call_booked')) {
    const calls = await context.db.from('appointments').select('id,starts_at').eq('status', 'booked').is('deleted_at', null).gt('starts_at', context.now.toISOString()).lte('starts_at', new Date(context.now.getTime() + ruleNumber(context, 'call_booked', 'remind_minutes', 15) * 60_000).toISOString()).order('starts_at').limit(100);
    if (calls.error) throw new Error('reminders_read_failed');
    for (const call of calls.data ?? []) { await queueNotification(context, `call_reminder:${call.id}:${call.starts_at}`, call.id); count++; }
  }
  if (context.enabled.has('new_lead')) {
    const leads = await allRows<{ id: string; created_at: string }>((from, to) => context.db.from('deals').select('id,created_at').eq('outcome', 'open').is('first_touch_at', null).is('deleted_at', null).is('merged_into_id', null).order('created_at').range(from, to));
    for (const lead of leads) {
      const clock = localClock(context.now);
      if (context.settings.call_hours.days.includes(clock.weekday % 7) && !context.settings.call_hours.holidays.includes(clock.day) && clock.time >= context.settings.call_hours.start && clock.time < context.settings.call_hours.end && workingMinutesBetween(lead.created_at, context.now, context.settings.call_hours) >= context.settings.speed_to_lead_minutes) {
        await queueNotification(context, `speed:${lead.id}`, lead.id, ['telegram']); count++;
      }
    }
  }
  return count;
}
export async function deliverNotifications(context: JobContext): Promise<number> {
  // Recover interrupted after() claims without duplicating currently active workers.
  const recovered = await context.db.from('notifications_log').update({ status: 'failed', error: 'lease_expired' }).eq('status', 'processing').lt('updated_at', new Date(context.now.getTime() - 10 * 60_000).toISOString());
  if (recovered.error) throw new Error('notification_recovery_failed');
  const telegramConfigured = telegramReady(), pushConfigured = pushReady();
  if (!telegramConfigured && !pushConfigured) return 0;
  let pendingQuery = context.db.from('notifications_log').select('id,event_key,entity_id,channel,status').in('status', ['pending', 'failed']);
  // An unavailable channel must not block delivery to an available one behind its backlog.
  if (!telegramConfigured) pendingQuery = pendingQuery.like('channel', 'push%');
  else if (!pushConfigured) pendingQuery = pendingQuery.eq('channel', 'telegram');
  const pending = await pendingQuery.order('created_at').limit(100);
  if (pending.error) throw new Error('notification_read_failed');
  const subscriptions = pushConfigured ? await ownerSubscriptions(context) : [];
  let count = 0;
  const notices = (pending.data ?? []) as Notice[];
  for (const notice of notices) {
    if (notice.channel === 'telegram' && !telegramConfigured) continue;
    if (notice.channel.startsWith('push') && !pushConfigured) continue;
    const claimed = await context.db.from('notifications_log').update({ status: 'processing' }).eq('id', notice.id).in('status', ['pending', 'failed']).select('id').maybeSingle();
    if (!claimed.data) continue;
    try {
      if (notice.event_key.startsWith('digest:') && notice.event_key !== `digest:${localClock(context.now).day}`) {
        await context.db.from('notifications_log').update({ status: 'skipped', error: 'digest_expired' }).eq('id', notice.id); continue;
      }
      if (notice.event_key.startsWith('speed:') && notice.entity_id) {
        const lead = await context.db.from('deals').select('first_touch_at,outcome,deleted_at').eq('id', notice.entity_id).single();
        if (lead.error) throw new Error('speed_notice_read_failed');
        if (!lead.data || lead.data.first_touch_at || lead.data.outcome !== 'open' || lead.data.deleted_at) {
          await context.db.from('notifications_log').update({ status: 'skipped', error: 'lead_already_handled' }).eq('id', notice.id); continue;
        }
      }
      if (notice.event_key.startsWith('call_reminder:') && notice.entity_id) {
        const appointment = await context.db.from('appointments').select('starts_at,status,deleted_at').eq('id', notice.entity_id).single();
        if (!appointment.data || appointment.data.status !== 'booked' || appointment.data.deleted_at || new Date(appointment.data.starts_at) <= context.now || !notice.event_key.endsWith(appointment.data.starts_at)) {
          await context.db.from('notifications_log').update({ status: 'skipped', error: 'appointment_changed' }).eq('id', notice.id); continue;
        }
      }
      const copy = notice.event_key.startsWith('digest:') ? { text: await digestText(context), path: '/today' } : notificationCopy(notice.event_key, notice.entity_id);
      if (notice.channel === 'push') {
        for (const subscription of subscriptions) {
          const result = await context.db.from('notifications_log').upsert({ event_key: notice.event_key, entity_id: notice.entity_id, channel: `push:${subscription.id}`, status: 'pending' }, { onConflict: 'event_key,channel', ignoreDuplicates: true }).select('id,event_key,entity_id,channel,status');
          if (result.error) throw new Error('push_fanout_failed');
          notices.push(...(result.data ?? []) as Notice[]);
        }
        await context.db.from('notifications_log').update({ status: 'expanded', error: null }).eq('id', notice.id);
        continue;
      }
      if (notice.channel === 'telegram') await sendTelegram(copy.text, copy.path);
      else if (notice.channel.startsWith('push:')) {
        const subscription = subscriptions.find((item) => item.id === notice.channel.slice(5));
        if (!subscription) { await context.db.from('notifications_log').update({ status: 'skipped', error: 'subscription_unavailable' }).eq('id', notice.id); continue; }
        const status = await deliverPush(subscription, { title: 'Lumen adl', body: copy.text, url: copy.path, tag: notice.event_key });
        if (status === 'gone') {
          await context.db.from('push_subscriptions').update({ deleted_at: context.now.toISOString() }).eq('id', subscription.id);
          await context.db.from('notifications_log').update({ status: 'skipped', error: 'subscription_expired' }).eq('id', notice.id); continue;
        }
      } else { await context.db.from('notifications_log').update({ status: 'skipped', error: 'unknown_channel' }).eq('id', notice.id); continue; }
      await context.db.from('notifications_log').update({ status: 'sent', sent_at: context.now.toISOString(), error: null }).eq('id', notice.id); count++;
    } catch { await context.db.from('notifications_log').update({ status: 'failed', error: 'notification_unconfirmed' }).eq('id', notice.id); }
  }
  return count;
}
