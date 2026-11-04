import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_WORKING_HOURS, type WorkingHours } from '@/lib/domain/time';
import { formatInTimeZone } from 'date-fns-tz';

export type JobDatabase = SupabaseClient;
export interface JobSettings {
  call_hours: WorkingHours; digest_time: string; speed_to_lead_minutes: number; retention_months: number; bin_retention_days: number;
  capi: { enabled: boolean; test_event_code: string; mapping: Record<string, string> };
  business?: { email?: string; phone?: string; trading_name?: string };
  invoices?: { payment_terms_days?: number };
}
export interface JobContext { db: JobDatabase; settings: JobSettings; enabled: Set<string>; rules?: Record<string, Record<string, unknown>>; now: Date }
export function ruleNumber(context: JobContext, key: string, field: string, fallback: number): number { const value = Number(context.rules?.[key]?.[field] ?? fallback); return Number.isFinite(value) && value > 0 ? value : fallback; }
export async function loadJobSettings(db: JobDatabase): Promise<JobSettings> {
  const { data, error } = await db.from('settings').select('config').eq('singleton', true).single();
  if (error || !data) throw new Error('settings_unavailable');
  const config = data.config as Partial<JobSettings>;
  return { ...config, call_hours: { ...DEFAULT_WORKING_HOURS, ...config.call_hours }, digest_time: config.digest_time ?? '07:30', speed_to_lead_minutes: config.speed_to_lead_minutes ?? 5, retention_months: config.retention_months ?? 12, bin_retention_days: Math.max(30, config.bin_retention_days ?? 30), capi: { enabled: false, test_event_code: '', mapping: {}, ...config.capi } };
}
export async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>, size = 500): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; offset < 500_000; offset += size) {
    const result = await page(offset, offset + size - 1);
    if (result.error) throw new Error('database_read_failed');
    rows.push(...(result.data ?? []) as T[]);
    if (!result.data || result.data.length < size) return rows;
  }
  throw new Error('dataset_exceeds_safe_export_limit');
}
export function localClock(now: Date) { return { day: formatInTimeZone(now, 'Australia/Adelaide', 'yyyy-MM-dd'), time: formatInTimeZone(now, 'Australia/Adelaide', 'HH:mm'), weekday: Number(formatInTimeZone(now, 'Australia/Adelaide', 'i')) }; }
export function dailyDue(now: Date, time: string, days = [1, 2, 3, 4, 5, 6, 7]): boolean { const clock = localClock(now); return days.includes(clock.weekday) && clock.time >= time; }
export async function runClaimed(context: JobContext, key: string, kind: string, work: () => Promise<number>, entityId: string | null = null, leaseSeconds = 300): Promise<{ status: 'done' | 'busy' | 'failed'; count: number }> {
  const claim = await context.db.rpc('claim_job', { p_key: key, p_kind: kind, p_entity_id: entityId, p_lease_seconds: leaseSeconds });
  if (claim.error) throw new Error('job_claim_failed');
  if (!claim.data) return { status: 'busy', count: 0 };
  try {
    const count = await work();
    const finished = await context.db.rpc('finish_job', { p_key: key, p_status: 'done', p_error: null });
    if (finished.error) throw new Error('job_finish_failed');
    return { status: 'done', count };
  } catch {
    await context.db.rpc('finish_job', { p_key: key, p_status: 'failed', p_error: `${kind}_failed`.slice(0, 100) });
    return { status: 'failed', count: 0 };
  }
}
export async function queueNotification(context: JobContext, eventKey: string, entityId: string | null, channels = ['telegram', 'push']) {
  for (const channel of channels) {
    const result = await context.db.from('notifications_log').upsert({ event_key: eventKey, entity_id: entityId, channel, status: 'pending' }, { onConflict: 'event_key,channel', ignoreDuplicates: true });
    if (result.error) throw new Error('notification_queue_failed');
  }
}
