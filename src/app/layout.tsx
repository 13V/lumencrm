import type { Metadata, Viewport } from 'next';
import './globals.css';
// Per-request CSP nonces require fresh HTML, including the sign-in screens.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: { default: 'Today · Lumen CRM', template: '%s · Lumen CRM' }, description: 'The private sales and client system for Lumen adl.', robots: { index: false, follow: false }, manifest: '/manifest.webmanifest', icons: { apple: '/icon-180.png' }, appleWebApp: { capable: true, title: 'Lumen', statusBarStyle: 'default' } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover', themeColor: '#F4F4F1' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en-AU" suppressHydrationWarning><body>{children}</body></html>; }
