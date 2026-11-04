import { timingSafeToken } from '@/lib/domain/security';
import { runJobs } from '@/lib/server/jobs/runner';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function GET(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1] ?? null;
  if (!timingSafeToken(token, process.env.CRON_SECRET)) return Response.json({ error: 'Unauthorised' }, { status: 401 });
  try { const result = await runJobs(); return Response.json(result, { status: result.ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: 'Scheduled work is unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
export const POST = GET;
