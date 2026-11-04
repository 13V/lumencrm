'use client';
import { Button } from '@/components/ui';
export default function ErrorPage({ reset }: { reset: () => void }) { return <main className="auth-page"><h1>That didn’t load.</h1><p className="muted">Your saved work is still there. Try again.</p><Button onClick={reset}>Try again</Button></main>; }
