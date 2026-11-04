import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { loadJobSettings, runClaimed, type JobContext, type JobDatabase } from '@/lib/server/jobs/shared';
describe('job leases', () => {
  it('uses the chosen twelve-month retention default while preserving an explicit custom period', async () => {
    for (const [config, expected] of [[{}, 12], [{ retention_months: 18 }, 18]] as const) {
      const db = { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { config }, error: null }) }) }) }) } as unknown as JobDatabase;
      expect((await loadJobSettings(db)).retention_months).toBe(expected);
    }
  });
  it('does not execute work when another worker owns the lease', async () => { const rpc = vi.fn().mockResolvedValue({ data: false, error: null }), work = vi.fn(); const result = await runClaimed({ db: { rpc } } as unknown as JobContext, 'job-1', 'test', work); expect(result.status).toBe('busy'); expect(work).not.toHaveBeenCalled(); });
  it('marks success durably', async () => { const rpc = vi.fn().mockResolvedValue({ data: true, error: null }); const result = await runClaimed({ db: { rpc } } as unknown as JobContext, 'job-1', 'test', async () => 3); expect(result).toEqual({ status: 'done', count: 3 }); expect(rpc).toHaveBeenLastCalledWith('finish_job', { p_key: 'job-1', p_status: 'done', p_error: null }); });
  it('stores an error code without personal data or a provider response body', async () => { const rpc = vi.fn().mockResolvedValue({ data: true, error: null }); const result = await runClaimed({ db: { rpc } } as unknown as JobContext, 'job-1', 'test', async () => { throw new Error('fiction@example.com secret'); }); expect(result.status).toBe('failed'); expect(rpc).toHaveBeenLastCalledWith('finish_job', { p_key: 'job-1', p_status: 'failed', p_error: 'test_failed' }); });
});
