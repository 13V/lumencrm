import { redirect, notFound } from 'next/navigation';
import { CrmApp } from '@/components/crm-app';
import { demoMode } from '@/lib/supabase/server';
import { createDemoData } from '@/lib/demo';
import { requireSession, HttpError } from '@/lib/server/auth';
import { loadCrm } from '@/lib/server/data';
export const dynamic = 'force-dynamic';
export default async function DealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (demoMode()) return <CrmApp initialData={createDemoData()} mode="demo" role="owner" section="leads" detailId={id} />;
  let session;
  try { session = await requireSession(); } catch (error) { if (error instanceof HttpError && error.status === 428) redirect('/auth/mfa'); redirect('/login'); }
  const data = await loadCrm(session, id);
  if (!data.deals.some(d => d.id === id)) notFound();
  return <CrmApp initialData={data} mode="live" role={session.profile.role} section="leads" detailId={id} />;
}
