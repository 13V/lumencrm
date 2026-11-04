const status = document.getElementById('status'), container = document.getElementById('leads');
let readVersion = 0;
document.getElementById('retry').addEventListener('click', () => location.assign('/today'));
document.getElementById('clear').addEventListener('click', async () => {
  ++readVersion; container.replaceChildren();
  try {
    localStorage.removeItem('lumen-device-user');
    navigator.serviceWorker?.controller?.postMessage({ type: 'CLEAR' });
    await Promise.all((await caches.keys()).filter(key => key.startsWith('lumen-read-')).map(key => caches.delete(key)));
    status.textContent = 'Offline data cleared.';
  } catch { status.textContent = 'Device data cleanup could not be confirmed. Reconnect and try again.'; }
});
(async () => {
  const version = readVersion, user = localStorage.getItem('lumen-device-user');
  const keys = (await caches.keys()).filter(key => key.startsWith('lumen-read-'));
  if (!user || !keys.includes(`lumen-read-${user}`)) { status.textContent = 'No offline snapshot is available. Open Today while connected first.'; return; }
  const cache = await caches.open(`lumen-read-${user}`), response = await cache.match('/api/crm');
  if (version !== readVersion || localStorage.getItem('lumen-device-user') !== user) return;
  if (!response) { status.textContent = 'No saved leads yet.'; return; }
  const { data } = await response.json();
  if (version !== readVersion || localStorage.getItem('lumen-device-user') !== user) return;
  if (data?.user?.id !== user || !Array.isArray(data.deals) || !Array.isArray(data.contacts) || !Array.isArray(data.businesses)) { status.textContent = 'No saved leads yet.'; return; }
  status.textContent = 'Saved open leads. This view may be out of date.';
  for (const deal of data.deals.filter(item => item.outcome === 'open').slice(0, 100)) {
    const contact = data.contacts.find(item => item.id === deal.contact_id), business = data.businesses.find(item => item.id === deal.business_id);
    const article = document.createElement('article'), heading = document.createElement('h2'), name = document.createElement('p'), next = document.createElement('p');
    heading.textContent = [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') || 'Contact'; name.textContent = business?.name || deal.title;
    next.textContent = deal.next_step ? `${deal.next_step}${deal.next_step_at ? ` · ${new Date(deal.next_step_at).toLocaleString('en-AU', { timeZone: 'Australia/Adelaide' })}` : ''}` : 'No next step';
    article.append(heading, name, next); container.append(article);
  }
})().catch(() => { if (readVersion === 0) status.textContent = 'Offline storage is not available on this device.'; });
