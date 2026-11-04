import { z } from 'zod';
import { requireSession, requireSameOrigin, apiError, HttpError } from '@/lib/server/auth';
import { requestAiDraft } from '@/lib/server/ai';
import { normalizePhone } from '@/lib/domain/phone';
const inputSchema = z.object({ action: z.enum(['summary', 'reply', 'parse']), deal_id: z.uuid().optional(), text: z.string().max(5000).optional() }).strict();
export async function GET() { try { const { db } = await requireSession(['owner']); const { data } = await db.from('settings').select('config').single(); return Response.json({ enabled: Boolean(data?.config?.ai_enabled), configured: Boolean(process.env.AI_PROVIDER_API_KEY), provider: 'Anthropic' }); } catch (error) { return apiError(error); } }
export async function POST(request: Request) {
  try {
    requireSameOrigin(request); const { db } = await requireSession(['owner']);
    const raw = await request.text(); if (raw.length > 12000) throw new HttpError(413, 'The request is too long.');
    const parsed = inputSchema.safeParse(JSON.parse(raw)); if (!parsed.success) throw new HttpError(400, 'Choose a task and provide a lead or pasted text.');
    const input = parsed.data;
    const [settings, products] = await Promise.all([db.from('settings').select('config').single(), db.from('products').select('name,price,kind,summary,included').eq('active', true).is('deleted_at', null)]);
    if (!settings.data?.config?.ai_enabled) throw new HttpError(403, 'The AI helper is off. Enable it in Settings first.');
    let lead: unknown = null, timeline: unknown = [];
    if (input.action !== 'parse') {
      if (!input.deal_id) throw new HttpError(400, 'Choose a lead.');
      const deal = await db.from('deals').select('id,contact_id,business_id,title,stage_key,outcome,next_step,promised_text,value_once,value_monthly,chloe_fields').eq('id', input.deal_id).is('deleted_at', null).single();
      if (!deal.data) throw new HttpError(404, 'Lead not found.');
      const [contact, business, activities] = await Promise.all([db.from('contacts').select('first_name,last_name,preferred_channel,best_time').eq('id', deal.data.contact_id).single(), deal.data.business_id ? db.from('businesses').select('name,trade,suburb,service_areas').eq('id', deal.data.business_id).single() : Promise.resolve({ data: null }), db.from('activities').select('type,body,occurred_at').eq('deal_id', input.deal_id).is('deleted_at', null).order('occurred_at', { ascending: false }).limit(30)]);
      lead = { ...deal.data, contact: contact.data, business: business.data }; timeline = activities.data;
    } else if (!input.text?.trim()) throw new HttpError(400, 'Paste some contact details first.');
    const draft = await requestAiDraft({ instruction: input.action, text: input.text, lead, timeline, products: products.data || [], terms_url: settings.data.config.quotes?.terms_url });
    if (input.action === 'parse') {
      const parsedLead = z.object({ first_name: z.string().max(200), last_name: z.string().max(200), business: z.string().max(200), phone: z.string().max(50), email: z.union([z.email(), z.literal('')]), suburb: z.string().max(200), notes: z.string().max(5000) }).parse(JSON.parse(draft.replace(/^```json\s*|\s*```$/g, '')));
      return Response.json({ draft: { ...parsedLead, phone: normalizePhone(parsedLead.phone) || '' }, draft_only: true });
    }
    return Response.json({ draft, draft_only: true });
  } catch (error) { if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: 'The draft could not be structured safely. Please review the original text.' }, { status: 400 }); return apiError(error); }
}
