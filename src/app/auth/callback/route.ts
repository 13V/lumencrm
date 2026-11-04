import { serverClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type');
  if (code || (tokenHash && tokenHash.length <= 1024 && (type === 'email' || type === 'invite'))) {
    const db = await serverClient();
    const { error } = code ? await db.auth.exchangeCodeForSession(code) : await db.auth.verifyOtp({ token_hash: tokenHash!, type: type as 'email' | 'invite' });
    if (!error) {
      const membership = await db.rpc('accept_invitation');
      if (!membership.error) return NextResponse.redirect(new URL('/today', url));
      await db.auth.signOut();
    }
  }
  return NextResponse.redirect(new URL('/login?error=link', url));
}
