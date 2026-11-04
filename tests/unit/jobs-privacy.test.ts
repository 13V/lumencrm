import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { removeQueuedFiles } from '@/lib/server/jobs/privacy';
import type { JobContext } from '@/lib/server/jobs/shared';

describe('deferred private file deletion', () => {
  it('reaps abandoned uploads but leaves an unexpired export download available', async () => {
    const now = new Date('2026-11-04T02:00:00Z');
    const rows = [{ id: 'expired', bucket: 'crm-exports', path: 'old.csv', attempts: 0, delete_after: '2026-11-04T01:00:00Z' }, { id: 'available', bucket: 'crm-exports', path: 'download.csv', attempts: 0, delete_after: '2026-11-04T03:00:00Z' }];
    const remove = vi.fn().mockResolvedValue({ error: null }), rpc = vi.fn().mockResolvedValue({ data: 1, error: null });
    let cutoff: string | undefined;
    const read = { is: () => read, lte: (_field: string, value: string) => { cutoff = value; return read; }, order: () => read, limit: async () => ({ data: rows.filter((row) => cutoff && row.delete_after <= cutoff), error: null }) };
    const db = { rpc, from: () => ({ select: () => read, update: () => ({ eq: async () => ({ error: null }) }) }), storage: { from: () => ({ remove }) } };
    expect(await removeQueuedFiles({ db, now } as unknown as JobContext)).toBe(1);
    expect(rpc).toHaveBeenCalledWith('reap_pending_uploads');
    expect(cutoff).toBe(now.toISOString());
    expect(remove).toHaveBeenCalledExactlyOnceWith(['old.csv']);
  });
});
