import 'server-only';
import { createClient } from '@supabase/supabase-js';

/** Restricted to verified integration handlers and scheduled jobs. Never import into client code. */
export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Integration database is not configured');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
