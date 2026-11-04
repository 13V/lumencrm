import 'server-only';
import { serverClient } from '@/lib/supabase/server';
import type { Role } from '@/lib/types';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
// Sign-in is by email link only (Troy, 4 Nov 2026): no authenticator step for any role.
// The second parameter is kept so existing callers still compile.
export async function requireSession(roles: Role[] = ['owner', 'staff', 'viewer'], _allowAal1 = false) {
  const db = await serverClient();
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) throw new HttpError(401, 'Sign in to continue.');
  const result = await db.rpc('get_my_profile');
  const profile = Array.isArray(result.data) ? result.data[0] : result.data;
  if (result.error || !profile || !roles.includes(profile.role)) throw new HttpError(403, 'Your account does not have access to this action.');
  return { db, user, profile: profile as { id: string; user_id: string; name: string; role: Role } };
}
export function requireSameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const expected = new URL(process.env.APP_URL || request.url).origin;
  if (!origin || origin !== expected) throw new HttpError(403, 'The request origin could not be verified.');
}
export function apiError(error: unknown) {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: 'The change could not be saved. Please try again.' }, { status: 500 });
}
