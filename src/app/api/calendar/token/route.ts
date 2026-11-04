import { requireSession, requireSameOrigin, apiError, HttpError } from '@/lib/server/auth';
import { secureToken, tokenHash } from '@/lib/domain/security';
export async function GET() {
  try { const { db, user } = await requireSession(['owner', 'staff']); const { count } = await db.from('calendar_tokens').select('id', { count: 'exact', head: true }).eq('user_id', user.id).is('revoked_at', null); return Response.json({ active: Boolean(count) }); } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request); const { db, user } = await requireSession(['owner', 'staff']);
    const input = await request.json(); if (!['create', 'revoke'].includes(input.action)) throw new HttpError(400, 'Choose create or revoke.');
    const revoked = await db.from('calendar_tokens').update({ revoked_at: new Date().toISOString() }).eq('user_id', user.id).is('revoked_at', null); if (revoked.error) throw new HttpError(400, 'Could not revoke the existing feed.');
    if (input.action === 'revoke') return Response.json({ url: null });
    const token = secureToken(); const result = await db.from('calendar_tokens').insert({ user_id: user.id, token_hash: tokenHash(token) });
    if (result.error) throw new HttpError(400, 'Could not create a calendar feed.');
    return Response.json({ url: `${process.env.APP_URL}/api/calendar/${token}.ics` });
  } catch (error) { return apiError(error); }
}
