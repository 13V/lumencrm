import 'server-only';
import { fromZonedTime } from 'date-fns-tz';
import { localClock, type JobContext } from './shared';

export function retentionCutoff(day: string, months: number): string {
  const [year, month, date] = day.split('-').map(Number);
  const first = new Date(Date.UTC(year, month - 1 - months, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  const target = `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(date, last)).padStart(2, '0')}`;
  return fromZonedTime(`${target}T00:00:00`, 'Australia/Adelaide').toISOString();
}
export async function applyRetention(context: JobContext): Promise<number> {
  const cutoff = retentionCutoff(localClock(context.now).day, context.settings.retention_months);
  const candidates = await context.db.rpc('retention_candidates', { p_before: cutoff, p_limit: 100 });
  if (candidates.error) throw new Error('retention_candidates_failed');
  let count = 0;
  for (const candidate of candidates.data ?? []) {
    const contactId = typeof candidate === 'string' ? candidate : candidate.contact_id ?? candidate.id;
    const result = await context.db.rpc('anonymise_contact', { p_contact_id: contactId });
    if (result.error) throw new Error('retention_anonymisation_failed');
    count++;
  }
  const purged = await context.db.rpc('purge_bin', { p_before: new Date(context.now.getTime() - context.settings.bin_retention_days * 86400_000).toISOString() });
  if (purged.error) throw new Error('bin_purge_failed');
  return count + Number(purged.data ?? 0);
}
export async function removeQueuedFiles(context: JobContext): Promise<number> {
  const staleUploads = await context.db.rpc('reap_pending_uploads');
  if (staleUploads.error) throw new Error('stale_upload_cleanup_failed');
  const rows = await context.db.from('storage_deletions').select('id,bucket,path,attempts').is('done_at', null).lte('delete_after', context.now.toISOString()).order('created_at').limit(100);
  if (rows.error) throw new Error('file_deletion_queue_failed');
  let count = 0;
  for (const row of rows.data ?? []) {
    const result = await context.db.storage.from(row.bucket).remove([row.path]);
    await context.db.from('storage_deletions').update({ attempts: Number(row.attempts) + 1, error: result.error ? 'storage_remove_failed' : null, done_at: result.error ? null : context.now.toISOString(), ...(result.error ? {} : { path: `removed/${row.id}` }) }).eq('id', row.id);
    if (!result.error) count++;
  }
  return count;
}
