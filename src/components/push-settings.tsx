'use client';
import { useEffect, useState } from 'react';
import type { CrmMode } from '@/lib/types';
import { useOnline } from './use-online';
export function PushSettings({ mode }: { mode: CrmMode }) {
  const online = useOnline();
  const [message, setMessage] = useState(''), [key, setKey] = useState(''), [active, setActive] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => { if (mode === 'live') void fetch('/api/push').then(r => r.json()).then(d => { setKey(d.configured ? d.public_key : ''); }); if ('serviceWorker' in navigator) void navigator.serviceWorker.getRegistration().then(r => r?.pushManager.getSubscription()).then(s => setActive(Boolean(s))); }, [mode]);
  async function toggle() {
    if (!online) { setMessage('Reconnect to change notifications.'); return; }
    setBusy(true); setMessage('');
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('Add Lumen to your iPhone home screen, then open it there to enable notifications.');
      const registration = await navigator.serviceWorker.ready;
      if (active) { const subscription = await registration.pushManager.getSubscription(); if (subscription) { await fetch('/api/push', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint }) }); await subscription.unsubscribe(); } setActive(false); setMessage('Notifications disabled on this device.'); }
      else { const permission = await Notification.requestPermission(); if (permission !== 'granted') throw new Error('Notifications were not enabled. You can change this in your browser settings.'); const padding = '='.repeat((4 - key.length % 4) % 4); const raw = atob((key + padding).replaceAll('-', '+').replaceAll('_', '/')); const applicationServerKey = Uint8Array.from(raw, c => c.charCodeAt(0)); const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey }); const response = await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(subscription.toJSON()) }); if (!response.ok) { await subscription.unsubscribe(); throw new Error('The subscription could not be saved.'); } setActive(true); setMessage('Notifications enabled on this device.'); }
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Notifications could not be changed.'); } finally { setBusy(false); }
  }
  return <section className="card"><h2>Notifications on this device</h2><p className="muted">New enquiries, replies you are handling, upcoming calls and accepted quotes. On iPhone, add Lumen to your home screen first.</p><button className="button button-outline" disabled={busy || !online || !key || mode === 'demo'} onClick={() => void toggle()}>{active ? 'Disable notifications' : 'Enable notifications'}</button>{!key && <p className="text-small muted">Configure web push keys to enable this.</p>}<p role="status">{message}</p></section>;
}
