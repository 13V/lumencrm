import { z } from 'zod';
import { timingSafeToken } from '@/lib/domain/security';
import { adminClient } from '@/lib/supabase/admin';
import { readOutcomes } from '@/lib/server/jobs/outcomes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1] ?? null;
  if (!timingSafeToken(token, process.env.OUTCOMES_EXPORT_TOKEN)) return Response.json({ error: 'Unauthorised' }, { status: 401 });
  const url = new URL(request.url);
  const filters = z.object({ from: z.string().datetime({ offset: true }).optional(), to: z.string().datetime({ offset: true }).optional(), channel: z.enum(['website', 'meta_form', 'chloe', 'referral', 'phone', 'business_card', 'manual', 'other']).optional() }).safeParse(Object.fromEntries([...url.searchParams].filter(([, value]) => value)));
  if (!filters.success) return Response.json({ error: 'Invalid filters', fields: filters.error.flatten().fieldErrors }, { status: 400 });
  if (filters.data.from && filters.data.to && filters.data.from >= filters.data.to) return Response.json({ error: 'The end date must follow the start date' }, { status: 400 });
  try {
    const db = adminClient();
    const limit = await db.rpc('consume_rate_limit', { p_key: 'export:outcomes', p_limit: 60, p_window_seconds: 60 });
    if (limit.error) throw new Error('rate_limit_unavailable');
    if (!limit.data) return Response.json({ error: 'Rate limit exceeded', retry_after: 60 }, { status: 429, headers: { 'Retry-After': '60' } });
    return Response.json(await readOutcomes(db, filters.data), { headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'The outcomes export is unavailable' }, { status: 503 }); }
}
