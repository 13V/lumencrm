'use client';
import { useEffect, useState } from 'react';
import { browserClient } from '@/lib/supabase/browser';
import { useRouter } from 'next/navigation';
export function MfaForm() {
  const [factor, setFactor] = useState(''); const [qr, setQr] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const router = useRouter();
  useEffect(() => { void browserClient().auth.mfa.listFactors().then(({ data, error }) => { if (error) setError('Could not load authenticators.'); else setFactor(data.totp.find(f => f.status === 'verified')?.id || ''); }); }, []);
  async function enrol() {
    setBusy(true);
    const result = await browserClient().auth.mfa.enroll({ factorType: 'totp', friendlyName: `Lumen ${new Date().toISOString().slice(0, 16)}` });
    if (result.error) setError('Could not add an authenticator. Try again.');
    else { setFactor(result.data.id); setQr(result.data.totp.qr_code); }
    setBusy(false);
  }
  return <div className="form-stack">{!factor ? <button className="button button-primary" onClick={enrol} disabled={busy}>Set up authenticator</button> : <form onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError('');
    const code = String(new FormData(event.currentTarget).get('code') || '');
    if (!/^\d{6}$/.test(code)) { setError('Enter the six-digit code.'); setBusy(false); return; }
    const result = await browserClient().auth.mfa.challengeAndVerify({ factorId: factor, code });
    if (result.error) setError('That code was not accepted. Try the latest code.'); else { router.replace('/today'); router.refresh(); }
    setBusy(false);
  }}>{qr && <><p>Scan this code in your authenticator app, then enter its six-digit code.</p><img src={qr} alt="Authenticator setup QR code" /></>}<label>Authenticator code<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required /></label><button className="button button-primary" disabled={busy}>Unlock workspace</button></form>}<p className="error-text" role="alert">{error}</p></div>;
}
