import { redirect, notFound } from 'next/navigation';
import { CrmApp } from '@/components/crm-app';
import { demoMode } from '@/lib/supabase/server';
import { createDemoData } from '@/lib/demo';
import { requireSession, HttpError } from '@/lib/server/auth';
import { loadCrm } from '@/lib/server/data';
import { loadCommerce } from '@/lib/server/commerce';
import { CommerceWorkspace } from '@/components/commerce-workspace';
import { createDemoCommerceData } from '@/lib/demo-commerce';
import { ReportsWorkspace } from '@/components/reports-workspace';

export const dynamic = 'force-dynamic';
const commerceRoutes = ['demos', 'quotes', 'projects', 'clients', 'invoices'];
const routes = ['today', 'leads', 'pipeline', 'calendar', 'tasks', 'settings', 'reports', ...commerceRoutes];
export default async function SectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!routes.includes(section)) notFound();
  if (demoMode()) { const data = createDemoData(); return <CrmApp initialData={data} mode="demo" role="owner" section={section}>{section === 'reports' ? <ReportsWorkspace crmData={data} mode="demo" role="owner" /> : commerceRoutes.includes(section) ? <CommerceWorkspace initialData={createDemoCommerceData(data)} crmData={data} mode="demo" role="owner" section={section} /> : undefined}</CrmApp>; }
  let session;
  try { session = await requireSession(section === 'settings' ? ['owner'] : ['quotes', 'clients', 'invoices', 'reports'].includes(section) ? ['owner', 'viewer'] : ['owner', 'staff', 'viewer']); }
  catch (error) { if (error instanceof HttpError && error.status === 428) redirect('/auth/mfa'); redirect('/login'); }
  const data = await loadCrm(session);
  return <CrmApp initialData={data} mode="live" role={session.profile.role} section={section}>{section === 'reports' ? <ReportsWorkspace crmData={data} mode="live" role={session.profile.role} /> : commerceRoutes.includes(section) ? <CommerceWorkspace initialData={await loadCommerce(session)} crmData={data} mode="live" role={session.profile.role} section={section} /> : undefined}</CrmApp>;
}
