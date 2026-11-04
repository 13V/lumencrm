import 'server-only';
import { createClient } from '@supabase/supabase-js';
/** Anonymous client can only invoke explicitly granted capability RPCs. */
export function publicClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
}
