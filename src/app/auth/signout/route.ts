import { serverClient } from '@/lib/supabase/server';
import { requireSameOrigin, apiError } from '@/lib/server/auth';
export async function POST(request: Request) {
  try { requireSameOrigin(request); await (await serverClient()).auth.signOut(); return Response.json({ ok: true }); } catch (error) { return apiError(error); }
}
