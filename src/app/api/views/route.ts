import { z } from 'zod';
import { requireSession, requireSameOrigin, apiError, HttpError } from '@/lib/server/auth';
const filter = z.record(z.string().max(50), z.union([z.string().max(300), z.boolean(), z.number()]));
const schema = z.discriminatedUnion('action', [z.object({ action: z.literal('save'), name: z.string().trim().min(1).max(100), filters: filter, sort: z.string().max(100).default('created_desc') }), z.object({ action: z.literal('remove'), id: z.uuid() })]);
export async function GET() {
  try { const { db, user } = await requireSession(); const { data, error } = await db.from('saved_views').select('*').eq('user_id', user.id).eq('entity', 'deals').is('deleted_at', null).order('name'); if (error) throw new HttpError(503, 'Saved views could not be loaded.'); return Response.json({ views: data }); } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try { requireSameOrigin(request); const { db, user } = await requireSession(['owner', 'staff']); const input = schema.safeParse(await request.json()); if (!input.success) throw new HttpError(400, 'Check the view name and filters.'); const result = input.data.action === 'save' ? await db.from('saved_views').insert({ user_id: user.id, entity: 'deals', name: input.data.name, filters: input.data.filters, sort: input.data.sort }).select('*').single() : await db.from('saved_views').update({ deleted_at: new Date().toISOString() }).eq('id', input.data.id).eq('user_id', user.id); if (result.error) throw new HttpError(400, 'This view could not be saved.'); return Response.json({ ok: true, view: result.data }); } catch (error) { return apiError(error); }
}
