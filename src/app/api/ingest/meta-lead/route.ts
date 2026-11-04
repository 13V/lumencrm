import { handleIngest } from '@/lib/server/ingest';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) { return handleIngest(request, 'meta'); }
