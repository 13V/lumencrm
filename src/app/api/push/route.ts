import { z } from 'zod';
import { requireSession, requireSameOrigin, apiError, HttpError } from '@/lib/server/auth';
import { pushReady, trustedPushEndpoint } from '@/lib/server/jobs/push';

const schema = z.object({ endpoint: z.string().url().max(2000).refine(trustedPushEndpoint, 'Unsupported push provider'), keys: z.object({ p256dh: z.string().max(120).refine((key) => Buffer.from(key, 'base64url').length === 65, 'Invalid push key'), auth: z.string().max(40).refine((key) => Buffer.from(key, 'base64url').length === 16, 'Invalid push secret') }) });
export async function GET() {
  try { await requireSession(['owner']); return Response.json({ configured: pushReady(), public_key: process.env.VAPID_PUBLIC_KEY ?? null }, { headers: { 'Cache-Control': 'private, no-store' } }); }
  catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request); const { db, user } = await requireSession(['owner']);
    if (!pushReady()) throw new HttpError(503, 'Web push is not configured.');
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) throw new HttpError(400, 'The browser push subscription is invalid.');
    const { endpoint, keys } = parsed.data;
    const result = await db.from('push_subscriptions').upsert({ user_id: user.id, endpoint, p256dh: keys.p256dh, auth: keys.auth, deleted_at: null }, { onConflict: 'endpoint' });
    if (result.error) throw new HttpError(400, 'This push subscription could not be saved.');
    return Response.json({ ok: true });
  } catch (error) { if (error instanceof SyntaxError || error instanceof z.ZodError) return Response.json({ error: 'Invalid push subscription.' }, { status: 400 }); return apiError(error); }
}
export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request); const { db, user } = await requireSession(['owner']);
    const input = z.object({ endpoint: z.string().max(2000) }).parse(await request.json());
    const result = await db.from('push_subscriptions').update({ deleted_at: new Date().toISOString() }).eq('endpoint', input.endpoint).eq('user_id', user.id);
    if (result.error) throw new HttpError(400, 'The subscription could not be removed.');
    return Response.json({ ok: true });
  } catch (error) { if (error instanceof SyntaxError || error instanceof z.ZodError) return Response.json({ error: 'Invalid push subscription.' }, { status: 400 }); return apiError(error); }
}
