import 'server-only';
import { adminClient } from '@/lib/supabase/admin';
import { adsReady, capiReady, deliverCapi, importAdSpend, queueCapi } from './meta';
import { backupWeek, expireOldBackups, weeklyBackup } from './backup';
import { draftOverdueReminders, draftSubscriptionInvoices, entityAutomations, expireQuotes, reviewOpenLeads } from './automations';
import { deliverNotifications, queueReminders } from './notifications';
import { applyRetention, removeQueuedFiles } from './privacy';
import { dailyDue, loadJobSettings, localClock, queueNotification, runClaimed, type JobContext } from './shared';

export async function runJobs(now = new Date()) {
  const db = adminClient(), settings = await loadJobSettings(db);
  const automations = await db.from('automations').select('key,enabled,config');
  if (automations.error) throw new Error('automations_unavailable');
  const enabled = new Set((automations.data ?? []).filter((row) => row.enabled).map((row) => row.key as string));
  const rules = Object.fromEntries((automations.data ?? []).map((row) => [row.key, row.config]));
  const context: JobContext = { db, settings, enabled, rules, now }, clock = localClock(now), bucket = Math.floor(now.getTime() / 300_000);
  const result: Record<string, { status: string; count: number }> = {};
  result.automations = await runClaimed(context, `automation_tick:${bucket}`, 'automation_tick', () => entityAutomations(context));
  result.reminders = await runClaimed(context, `reminder_tick:${bucket}`, 'reminder_tick', () => queueReminders(context));
  result.expiry = await runClaimed(context, `expiry_tick:${bucket}`, 'expiry_tick', () => expireQuotes(context));
  if (dailyDue(now, settings.digest_time, [1, 2, 3, 4, 5, 6])) result.digest = await runClaimed(context, `digest_schedule:${clock.day}`, 'digest_schedule', async () => { await queueNotification(context, `digest:${clock.day}`, null, ['telegram']); return 1; });
  result.notifications = await runClaimed(context, `notification_tick:${bucket}`, 'notification_tick', () => deliverNotifications(context));
  if (settings.capi.enabled) {
    result.capi_queue = await runClaimed(context, `capi_queue_tick:${bucket}`, 'capi_queue_tick', () => queueCapi(context));
    result.capi_send = capiReady() ? await runClaimed(context, `capi_send_tick:${bucket}`, 'capi_send_tick', () => deliverCapi(context)) : { status: 'not_configured', count: 0 };
  } else result.capi_send = { status: 'disabled', count: 0 };
  if (dailyDue(now, '06:05')) result.ad_spend = adsReady() ? await runClaimed(context, `ad_spend:${clock.day}`, 'ad_spend', () => importAdSpend(context)) : { status: 'not_configured', count: 0 };
  result.billing = await runClaimed(context, `billing:${clock.day}`, 'billing', () => draftSubscriptionInvoices(context));
  result.overdue = await runClaimed(context, `overdue:${clock.day}`, 'overdue', () => draftOverdueReminders(context));
  result.lead_review = await runClaimed(context, `lead_review:${clock.day}`, 'lead_review', () => reviewOpenLeads(context));
  result.retention = await runClaimed(context, `retention:${clock.day}`, 'retention', () => applyRetention(context));
  result.file_removal = await runClaimed(context, `file_removal:${bucket}`, 'file_removal', () => removeQueuedFiles(context));
  if (dailyDue(now, '03:00')) {
    result.backup = process.env.BACKUP_ENCRYPTION_KEY ? await runClaimed(context, `weekly_backup:${backupWeek(clock.day)}`, 'weekly_backup', () => weeklyBackup(context), null, 600) : { status: 'not_configured', count: 0 };
    result.backup_retention = await runClaimed(context, `backup_retention:${clock.day}`, 'backup_retention', () => expireOldBackups(context));
  }
  return { ok: !Object.values(result).some((job) => job.status === 'failed'), as_of: now.toISOString(), jobs: result };
}
