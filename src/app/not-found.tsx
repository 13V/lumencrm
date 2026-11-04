import Link from 'next/link';
export default function NotFound() { return <main className="auth-page"><h1>Nothing here.</h1><p>This link may have changed or expired.</p><Link href="/today" className="button button-primary">Back to Today</Link></main>; }
