/* Static assets and one explicitly user-scoped read snapshot. Never queue writes. */
const SHELL = 'lumen-shell-v2';
const STATIC = ['/offline.html', '/offline.js', '/offline.css', '/icon.svg'];
let currentUser = null;
let scopeVersion = 0;
let cacheWork = Promise.resolve();
function serialCache(work) { const result = cacheWork.then(work); cacheWork = result.catch(() => {}); return result; }
function clearReadCaches(keep) { return caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('lumen-read-') && key !== keep).map(key => caches.delete(key)))); }
function offlineUnavailable() { return new Response(JSON.stringify({ error: 'No offline snapshot is available.' }), { status: 503, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }); }
self.addEventListener('install', event => { event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(STATIC))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(Promise.all([self.clients.claim(), caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('lumen-shell-') && key !== SHELL).map(key => caches.delete(key))))])); });
self.addEventListener('message', event => {
  if (event.data?.type === 'USER' && typeof event.data.userId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(event.data.userId)) {
    currentUser = event.data.userId;
    const version = ++scopeVersion, user = currentUser;
    event.waitUntil(serialCache(() => version === scopeVersion ? clearReadCaches(`lumen-read-${user}`) : undefined).then(() => event.ports?.[0]?.postMessage({ ok: true })));
  }
  if (event.data?.type === 'CLEAR') { currentUser = null; ++scopeVersion; event.waitUntil(serialCache(() => clearReadCaches()).then(() => event.ports?.[0]?.postMessage({ ok: true }))); }
});
async function operationalSnapshot(request, user, version) {
  const current = () => user === currentUser && version === scopeVersion;
  let response;
  try { response = await fetch(request); }
  catch {
    return serialCache(async () => {
      if (!current()) return offlineUnavailable();
      const cache = await caches.open(`lumen-read-${user}`), saved = await cache.match('/api/crm');
      return current() && saved ? saved : offlineUnavailable();
    }).catch(() => offlineUnavailable());
  }
  if ([401, 403, 428].includes(response.status)) {
    const clearAll = current();
    if (clearAll) { currentUser = null; ++scopeVersion; }
    try { await serialCache(() => clearAll ? clearReadCaches() : user !== currentUser ? caches.delete(`lumen-read-${user}`) : undefined); } catch { /* Never serve cached data after known access denial. */ }
    return response;
  }
  if (response.ok && current() && response.headers.get('Content-Type')?.includes('application/json')) {
    try {
      const snapshot = await response.clone().json();
      // The authenticated server response, not a page's USER message, proves the account.
      if (snapshot?.data?.user?.id !== user) return response;
      await serialCache(async () => { if (!current()) return; const cache = await caches.open(`lumen-read-${user}`); if (current()) await cache.put('/api/crm', response.clone()); });
    } catch { /* A storage or JSON failure must not turn a valid network response into stale data. */ }
  }
  return response;
}
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== 'GET') return;
  if (url.pathname === '/api/crm' && !url.search && currentUser) {
    event.respondWith(operationalSnapshot(request, currentUser, scopeVersion));
    return;
  }
  if (request.mode === 'navigate') event.respondWith(fetch(request).catch(async () => /^\/(today|leads(?:\/[^/]+)?|pipeline|calendar|tasks)\/?$/.test(url.pathname) ? (await caches.match('/offline.html')) || new Response('Connect to open Lumen CRM.', { status: 503 }) : new Response('Connect to open this page.', { status: 503 })));
  else if (STATIC.includes(url.pathname)) event.respondWith(fetch(request).catch(() => caches.match(request)));
});
self.addEventListener('push', event => {
  let payload = {}; try { payload = event.data?.json() || {}; } catch { payload = { body: 'There is an update in your workspace.' }; }
  let url = '/today'; try { const candidate = new URL(payload.url || '/today', self.location.origin); if (candidate.origin === self.location.origin) url = candidate.pathname; } catch { /* Use safe home route. */ }
  event.waitUntil(self.registration.showNotification(payload.title || 'Lumen adl', { body: payload.body || 'Your workspace has an update.', icon: '/icon.svg', tag: payload.tag || 'lumen-update', data: { url } }));
});
self.addEventListener('notificationclick', event => { event.notification.close(); event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async clients => { const url = new URL(event.notification.data?.url || '/today', self.location.origin).toString(); for (const client of clients) { if ('navigate' in client) await client.navigate(url); return client.focus(); } return self.clients.openWindow(url); })); });
