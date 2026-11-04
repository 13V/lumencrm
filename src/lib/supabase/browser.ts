'use client';
import { createBrowserClient } from '@supabase/ssr';
export function browserClient() {
  // Stay signed in for 30 days from the last visit.
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    cookieOptions: { sameSite: 'lax', secure: location.protocol === 'https:', path: '/', maxAge: 60 * 60 * 24 * 30 },
  });
}
