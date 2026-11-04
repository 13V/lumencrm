import 'server-only';
import { createClient } from '@supabase/supabase-js';

/** Trusted, owner-requested background job. Never called by the browser directly. */
export async function sendInvitationJob(invitationId: string) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: invitation } = await db.from('user_invitations').select('email,accepted_at,expires_at').eq('id', invitationId).is('deleted_at', null).single();
  if (!invitation || invitation.accepted_at || new Date(invitation.expires_at) < new Date()) return;
  const { error } = await db.auth.admin.inviteUserByEmail(invitation.email, { redirectTo: `${process.env.APP_URL}/auth/callback` });
  await db.from('notifications_log').upsert({ channel: 'system', event_key: `invitation:${invitationId}`, entity_id: invitationId, status: error ? 'failed' : 'sent', sent_at: error ? null : new Date().toISOString(), error: error ? 'Invitation delivery failed. Review the Supabase Auth configuration.' : null }, { onConflict: 'event_key,channel' });
}
