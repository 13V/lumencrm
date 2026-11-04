import { z } from 'zod';
import { isIP } from 'node:net';
import { publicClient } from '@/lib/supabase/public';
import { requireSameOrigin, apiError } from '@/lib/server/auth';
const schema = z.discriminatedUnion('action', [z.object({ action: z.literal('view') }), z.object({ action: z.literal('accept'), name: z.string().trim().min(2).max(200), terms_accepted: z.literal(true) })]);
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    requireSameOrigin(request); const { token } = await params;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !process.env.NEXT_PUBLIC_SUPABASE_URL) return Response.json({ error: 'Quote not found.' }, { status: 404 });
    const raw = await request.text(); if (raw.length > 2000) return Response.json({ error: 'Request too large.' }, { status: 413 });
    const input = schema.safeParse(JSON.parse(raw)); if (!input.success) return Response.json({ error: 'Enter your full name and accept the written terms.' }, { status: 400 });
    const db = publicClient();
    if (input.data.action === 'view') { const result = await db.rpc('record_quote_view', { p_token: token }); return Response.json({ ok: !result.error }, { status: result.error ? 400 : 200 }); }
    // Vercel supplies x-forwarded-for. Local/manual callers may omit it; it is evidence, not identity.
    const candidate = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    const { data, error } = await db.rpc('accept_quote', { p_token: token, p_name: input.data.name, p_terms_accepted: true, p_ip: candidate && isIP(candidate) ? candidate : null, p_user_agent: request.headers.get('user-agent')?.slice(0, 1000) || null });
    if (error) return Response.json({ error: 'This quote cannot be accepted. It may have expired or been replaced. Please contact Troy.' }, { status: 409 });
    return Response.json({ ok: true, already_accepted: data.already_accepted, accepted_at: data.accepted_at });
  } catch (error) { return apiError(error); }
}
