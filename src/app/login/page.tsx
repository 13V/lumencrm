import { configured, demoMode } from '@/lib/supabase/server';
import { LoginForm } from './ui';
export default function LoginPage() {
  return <main className="auth-page"><div className="brand"><span className="brand-name">Lumen</span><span className="brand-adl">adl</span></div><h1>Your business, in focus.</h1><p className="muted">Sign in to your private sales and client system.</p>{configured() ? <LoginForm /> : <div className="card"><h2>Connect your workspace</h2><p>Set the Supabase variables from <code>.env.example</code> in your local environment or Vercel, then restart the app.</p>{demoMode() && <a className="button button-primary" href="/today">Open fictional preview</a>}</div>}<p className="text-small muted">Invited accounts only. Owners use an authenticator for a second layer of protection.</p></main>;
}
