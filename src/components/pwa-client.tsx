'use client';
import { useEffect, useState } from 'react';
function clearDrafts() { try { for (const key of Object.keys(localStorage)) if (key.startsWith('lumen-note-draft-') || key.startsWith('lumen-timer-')) localStorage.removeItem(key); } catch {} }
let deviceEpoch = 0;
async function workerScope(worker: ServiceWorker | null | undefined, message: { type: 'USER' | 'CLEAR'; userId?: string }) {
  if (!worker) return;
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel(), timeout = setTimeout(() => { channel.port1.close(); reject(new Error('Offline scope was not confirmed')); }, 3000);
    channel.port1.onmessage = (event) => { clearTimeout(timeout); channel.port1.close(); if (event.data?.ok) resolve(); else reject(new Error('Offline scope was not confirmed')); };
    worker.postMessage(message, [channel.port2]);
  });
}
async function clearOfflineData() {
  let failed = false;
  try { localStorage.removeItem('lumen-device-user'); } catch { failed = true; }
  try { if ('serviceWorker' in navigator) { const registration = await navigator.serviceWorker.getRegistration(); await workerScope(navigator.serviceWorker.controller || registration?.active, { type: 'CLEAR' }); } } catch { failed = true; }
  try { if ('caches' in window) await Promise.all((await caches.keys()).filter(key => key.startsWith('lumen-read-')).map(key => caches.delete(key))); } catch { failed = true; }
  if (failed) throw new Error('Device cleanup was not confirmed');
}
/** Invalidate in-flight cache setup before deleting or signing out of personal data. */
export async function clearDeviceData() { ++deviceEpoch; await clearOfflineData(); }
export function PwaClient({ userId, enabled = true }: { userId: string; enabled?: boolean }) {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let cancelled = false; const epoch = ++deviceEpoch, controller = new AbortController();
    let changedUser = false;
    try { const previous = localStorage.getItem('lumen-device-user'); changedUser = previous !== userId; if (changedUser) { clearDrafts(); localStorage.removeItem('lumen-device-user'); } } catch {}
    const state = () => setOffline(!navigator.onLine); state(); window.addEventListener('online', state); window.addEventListener('offline', state);
    if (enabled && userId && 'serviceWorker' in navigator) void (async () => {
      // Register first so an older worker without acknowledgements can still update.
      await navigator.serviceWorker.register('/sw.js');
      if (changedUser) await clearOfflineData();
      if (cancelled || epoch !== deviceEpoch) return;
      const ready = await navigator.serviceWorker.ready;
      if (cancelled || epoch !== deviceEpoch) return;
      await workerScope(navigator.serviceWorker.controller || ready.active, { type: 'USER', userId });
      if (cancelled || epoch !== deviceEpoch) return;
      localStorage.setItem('lumen-device-user', userId);
      await fetch('/api/crm', { cache: 'no-store', signal: controller.signal });
    })().catch(() => { /* Offline cache is optional when browser policy disables service workers. */ });
    return () => { cancelled = true; controller.abort(); window.removeEventListener('online', state); window.removeEventListener('offline', state); };
  }, [enabled, userId]);
  return offline ? <div className="viewer-notice" role="status">Offline · read only. Reconnect to save changes or send messages.</div> : null;
}
export function SignOutButton() {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  return <div><button className="button button-outline" disabled={busy} onClick={async () => {
    setBusy(true); setError(''); ++deviceEpoch; clearDrafts();
    try {
      let cleanupFailed = false; try { await clearOfflineData(); } catch { cleanupFailed = true; }
      const result = await fetch('/auth/signout', { method: 'POST' });
      if (!result.ok) throw new Error('Sign out could not be confirmed. Reconnect and try again.');
      if (cleanupFailed) throw new Error('Device cleanup was not confirmed.');
      location.assign('/login');
    } catch { setError('Sign out could not be fully confirmed. Reconnect and try again.'); setBusy(false); }
  }}>Sign out</button>{error && <p role="alert" className="error-text">{error}</p>}</div>;
}
