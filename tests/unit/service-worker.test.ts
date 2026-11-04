import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const origin = 'https://crm.example.com';
type CacheRequest = string | { url: string };
function cacheHarness() {
  const stores = new Map<string, Map<string, Response>>();
  const key = (value: CacheRequest) => new URL(typeof value === 'string' ? value : value.url, origin).href;
  let pausePut: (() => Promise<void>) | undefined;
  const caches = {
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    open: async (name: string) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name)!;
      return {
        addAll: async (urls: string[]) => { for (const url of urls) entries.set(key(url), new Response(`Static ${url}`)); },
        put: async (request: CacheRequest, response: Response) => { if (pausePut) await pausePut(); entries.set(key(request), response.clone()); },
        match: async (request: CacheRequest) => entries.get(key(request))?.clone(),
      };
    },
    match: async (request: CacheRequest) => { for (const entries of stores.values()) if (entries.has(key(request))) return entries.get(key(request))?.clone(); },
  };
  return { caches, stores, pauseNextPut: (work: () => Promise<void>) => { pausePut = work; } };
}
function worker() {
  const storage = cacheHarness(), listeners: Record<string, (event: unknown) => void> = {};
  const fetch = vi.fn();
  const self = { location: { origin }, addEventListener: (name: string, listener: (event: unknown) => void) => { listeners[name] = listener; }, skipWaiting: vi.fn(), clients: { claim: vi.fn().mockResolvedValue(undefined), matchAll: vi.fn().mockResolvedValue([]), openWindow: vi.fn() }, registration: { showNotification: vi.fn() } };
  new Script(readFileSync('public/sw.js', 'utf8')).runInNewContext({ self, caches: storage.caches, fetch, URL, Response, Promise });
  async function message(data: Record<string, unknown>) {
    const waits: Promise<unknown>[] = [], acknowledgement = vi.fn();
    listeners.message({ data, ports: [{ postMessage: acknowledgement }], waitUntil: (value: Promise<unknown>) => waits.push(value) });
    await Promise.all(waits); return acknowledgement;
  }
  function request(path: string, method = 'GET', mode = 'cors'): Promise<Response> | undefined {
    let response: Promise<Response> | undefined;
    listeners.fetch({ request: { url: new URL(path, origin).href, method, mode }, respondWith: (value: Promise<Response>) => { response = value; } });
    return response;
  }
  async function install() { const waits: Promise<unknown>[] = []; listeners.install({ waitUntil: (value: Promise<unknown>) => waits.push(value) }); await Promise.all(waits); }
  return { ...storage, fetch, message, request, install };
}
const snapshot = (id: string) => Response.json({ data: { user: { id }, deals: [], contacts: [], businesses: [] } });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };

describe('operational offline cache privacy', () => {
  it('caches only a scoped, authenticated, exact GET /api/crm snapshot', async () => {
    const sw = worker(); sw.fetch.mockResolvedValue(snapshot('owner-a'));
    expect(sw.request('/api/crm')).toBeUndefined();
    await sw.message({ type: 'USER', userId: 'owner-a' });
    for (const path of ['/api/settings', '/api/reports', '/api/commerce', '/api/invoices', '/api/export/outcomes', '/q/public-token', '/api/crm?detail_id=lead-1', 'https://outside.example.com/api/crm']) expect(sw.request(path)).toBeUndefined();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(sw.request('/api/crm', method)).toBeUndefined();
    expect(sw.fetch).not.toHaveBeenCalled();
    await sw.request('/api/crm');
    expect(await sw.caches.keys()).toEqual(['lumen-read-owner-a']);
    expect((await (await sw.caches.open('lumen-read-owner-a')).match('/api/crm'))?.status).toBe(200);
  });

  it('clears another account and refuses to cache a response belonging to it', async () => {
    const sw = worker(); await sw.message({ type: 'USER', userId: 'owner-a' }); sw.fetch.mockResolvedValue(snapshot('owner-a')); await sw.request('/api/crm');
    const acknowledgement = await sw.message({ type: 'USER', userId: 'owner-b' });
    expect(acknowledgement).toHaveBeenCalledWith({ ok: true });
    expect(await sw.caches.keys()).toEqual([]);
    await sw.request('/api/crm'); // The server response is still account A.
    expect(await sw.caches.keys()).toEqual([]);
    sw.fetch.mockRejectedValue(new Error('Offline'));
    expect((await sw.request('/api/crm'))?.status).toBe(503);
  });

  it('does not persist a successful HTML login page or an unverified JSON response', async () => {
    const sw = worker(); await sw.message({ type: 'USER', userId: 'owner-a' });
    sw.fetch.mockResolvedValue(new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } })); await sw.request('/api/crm');
    sw.fetch.mockResolvedValue(Response.json({ data: { deals: [] } })); await sw.request('/api/crm');
    expect(await sw.caches.keys()).toEqual([]);
  });

  it.each([401, 403, 428])('clears private data on HTTP %i without returning a cached response', async status => {
    const sw = worker(); await sw.message({ type: 'USER', userId: 'owner-a' }); sw.fetch.mockResolvedValue(snapshot('owner-a')); await sw.request('/api/crm');
    sw.fetch.mockResolvedValue(Response.json({ error: 'Access denied' }, { status }));
    expect((await sw.request('/api/crm'))?.status).toBe(status);
    expect(await sw.caches.keys()).toEqual([]);
    expect(sw.request('/api/crm')).toBeUndefined();
  });

  it('serves the last authorised snapshot on network failure but preserves live server errors', async () => {
    const sw = worker(); await sw.message({ type: 'USER', userId: 'owner-a' }); sw.fetch.mockResolvedValue(snapshot('owner-a')); await sw.request('/api/crm');
    sw.fetch.mockResolvedValue(new Response('Server unavailable', { status: 500 })); expect((await sw.request('/api/crm'))?.status).toBe(500);
    sw.fetch.mockRejectedValue(new Error('Offline'));
    expect((await (await sw.request('/api/crm'))?.json()).data.user.id).toBe('owner-a');
  });

  it('does not recreate a signed-out account cache after a delayed response arrives', async () => {
    const sw = worker(), network = deferred<Response>(); await sw.message({ type: 'USER', userId: 'owner-a' }); sw.fetch.mockReturnValue(network.promise);
    const pending = sw.request('/api/crm'); await sw.message({ type: 'CLEAR' }); network.resolve(snapshot('owner-a')); await pending;
    expect(await sw.caches.keys()).toEqual([]);
  });

  it('waits for an in-progress cache write before acknowledging CLEAR', async () => {
    const sw = worker(), started = deferred<void>(), release = deferred<void>(); await sw.message({ type: 'USER', userId: 'owner-a' });
    sw.pauseNextPut(async () => { started.resolve(); await release.promise; }); sw.fetch.mockResolvedValue(snapshot('owner-a'));
    const pending = sw.request('/api/crm'); await started.promise;
    const clearing = sw.message({ type: 'CLEAR' }); release.resolve(); await Promise.all([pending, clearing]);
    expect(await sw.caches.keys()).toEqual([]);
  });

  it('does not return an old account snapshot after a failed in-flight request crosses accounts', async () => {
    const sw = worker(); await sw.message({ type: 'USER', userId: 'owner-a' }); sw.fetch.mockResolvedValue(snapshot('owner-a')); await sw.request('/api/crm');
    let reject!: (reason: Error) => void; sw.fetch.mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    const pending = sw.request('/api/crm'); await sw.message({ type: 'USER', userId: 'owner-b' }); reject(new Error('Offline'));
    expect((await pending)?.status).toBe(503); expect(await sw.caches.keys()).toEqual([]);
  });

  it('uses the read-only shell for operational navigation, never a public quote or login page', async () => {
    const sw = worker(); await sw.install(); sw.fetch.mockRejectedValue(new Error('Offline'));
    expect(await (await sw.request('/today', 'GET', 'navigate'))?.text()).toBe('Static /offline.html');
    for (const path of ['/q/public-token', '/login', '/settings', '/invoices']) {
      const result = await sw.request(path, 'GET', 'navigate'); expect(result?.status).toBe(503); expect(await result?.text()).not.toContain('/offline.html');
    }
  });
});

describe('read-only offline page account checks', () => {
  it('does not show a different account or use HTML from cached contact fields', async () => {
    const storage = cacheHarness();
    const response = Response.json({ data: { user: { id: 'owner-a' }, deals: [{ id: 'd', contact_id: 'c', business_id: 'b', outcome: 'open', next_step: 'Call tomorrow' }], contacts: [{ id: 'c', first_name: '<img src=x onerror=alert(1)>' }], businesses: [{ id: 'b', name: 'Fictional business' }] } });
    await (await storage.caches.open('lumen-read-owner-a')).put('/api/crm', response);
    type Element = { textContent: string; children: Element[]; handlers: Record<string, () => unknown>; addEventListener: (name: string, handler: () => unknown) => void; append: (...children: Element[]) => void; replaceChildren: () => void };
    const element = (): Element => { const node: Element = { textContent: '', children: [], handlers: {}, addEventListener(name, handler) { node.handlers[name] = handler; }, append(...children) { node.children.push(...children); }, replaceChildren() { node.children = []; } }; return node; };
    const nodes = { status: element(), leads: element(), retry: element(), clear: element() };
    let user: string | null = 'owner-b';
    const environment = { caches: storage.caches, document: { getElementById: (id: keyof typeof nodes) => nodes[id], createElement: element }, localStorage: { getItem: () => user, removeItem: () => { user = null; } }, navigator: { serviceWorker: { controller: { postMessage: vi.fn() } } }, location: { assign: vi.fn() }, Date };
    const script = new Script(readFileSync('public/offline.js', 'utf8'));
    await script.runInNewContext({ ...environment }); expect(nodes.leads.children).toHaveLength(0);
    user = 'owner-a'; await script.runInNewContext({ ...environment });
    expect(nodes.leads.children).toHaveLength(1);
    expect(nodes.leads.children[0].children[0].textContent).toBe('<img src=x onerror=alert(1)>');
    expect('innerHTML' in nodes.leads.children[0]).toBe(false);
    await nodes.clear.handlers.click(); expect(nodes.leads.children).toHaveLength(0); expect(user).toBeNull(); expect(await storage.caches.keys()).toEqual([]);
  });
});
