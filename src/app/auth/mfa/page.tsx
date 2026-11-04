import { redirect } from 'next/navigation';
import { requireSession } from '@/lib/server/auth';
import { MfaForm } from './ui';
export default async function MfaPage() {
  try { await requireSession(['owner', 'staff', 'viewer'], true); } catch { redirect('/login'); }
  return <main className="auth-page"><div className="brand"><span className="brand-name">Lumen</span><span className="brand-adl">adl</span></div><h1>One more check.</h1><p className="muted">Use your authenticator app to unlock your workspace.</p><MfaForm /></main>;
}
