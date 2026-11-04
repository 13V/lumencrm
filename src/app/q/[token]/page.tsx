import { notFound } from 'next/navigation';
import { publicClient } from '@/lib/supabase/public';
import { PublicQuoteView } from './ui';
import type { PublicQuote } from '@/lib/public-quote';
import '../quote.css';
export const dynamic = 'force-dynamic';
export const metadata = { title: 'Your quote · Lumen adl', robots: { index: false, follow: false } };
export default async function QuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !process.env.NEXT_PUBLIC_SUPABASE_URL) notFound();
  const { data, error } = await publicClient().rpc('public_quote', { p_token: token });
  if (error || !data) notFound();
  return <PublicQuoteView quote={data as PublicQuote} token={token} />;
}
