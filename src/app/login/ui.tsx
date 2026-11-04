'use client';
import { useState } from 'react';
import { browserClient } from '@/lib/supabase/browser';
import { z } from 'zod';
export function LoginForm() {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  return <form onSubmit={async event => {
    event.preventDefault(); setBusy(true);
    const email = new FormData(event.currentTarget).get('email');
    const result = z.email().max(254).safeParse(email);
    if (!result.success) { setMessage('Enter a valid email address.'); setBusy(false); return; }
    const { error } = await browserClient().auth.signInWithOtp({ email: result.data, options: { shouldCreateUser: false, emailRedirectTo: `${location.origin}/auth/callback` } });
    setMessage(error ? 'We could not send a sign-in link. Check your invitation and try again.' : 'Check your email for your sign-in link.'); setBusy(false);
  }}><label>Email<input name="email" type="email" autoComplete="email" inputMode="email" required /></label><button className="button button-primary" disabled={busy}>{busy ? 'Sending link…' : 'Email me a sign-in link'}</button><p role="status">{message}</p></form>;
}
