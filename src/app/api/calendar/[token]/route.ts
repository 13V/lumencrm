import { createClient } from '@supabase/supabase-js';
import { tokenHash } from '@/lib/domain/security';
import { calendarIcs, type CalendarEvent } from '@/lib/domain/calendar';
export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token: path } = await params; const token = path.replace(/\.ics$/, '');
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !process.env.NEXT_PUBLIC_SUPABASE_URL) return new Response('Not found', { status: 404 });
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
  const { data, error } = await db.rpc('calendar_feed', { p_hash: tokenHash(token) });
  if (error || data === null) return new Response('Not found', { status: 404 });
  return new Response(calendarIcs(data as CalendarEvent[]), { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'private, no-store', 'Content-Disposition': 'inline; filename="lumen-calls.ics"' } });
}
