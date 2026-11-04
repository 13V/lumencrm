import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ role: 'owner', rows: {} as Record<string, Record<string, unknown>[]>, rpc: vi.fn(), info: vi.fn(), remove: vi.fn(), signed: vi.fn(), fetch: vi.fn() }));
vi.mock('@/lib/server/auth', () => {
  class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
  function from(table: string) {
    const filters: ((row: Record<string, unknown>) => boolean)[] = [];
    let size = 1000, single = false, patch: Record<string, unknown> | undefined;
    const query = {
      select: () => query, order: () => query,
      limit: (n: number) => { size = Math.min(n, 1000); return query; },
      is: (field: string, value: unknown) => { filters.push(row => row[field] === value); return query; },
      eq: (field: string, value: unknown) => { filters.push(row => row[field] === value); return query; },
      in: (field: string, values: unknown[]) => { filters.push(row => values.includes(row[field])); return query; },
      gt: (field: string, value: string) => { filters.push(row => String(row[field]) > value); return query; },
      single: () => { single = true; return query; }, maybeSingle: () => { single = true; return query; },
      update: (input: Record<string, unknown>) => { patch = input; return query; },
      then: (resolve: (result: unknown) => unknown) => {
        const rows = (state.rows[table] || []).filter(row => filters.every(f => f(row))).sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, size);
        if (patch) for (const row of rows) Object.assign(row, patch);
        return Promise.resolve({ data: single ? rows[0] || null : rows, error: null }).then(resolve);
      },
    };
    return query;
  }
  return {
    HttpError,
    requireSession: async (roles: string[] = ['owner', 'staff', 'viewer']) => {
      if (!roles.includes(state.role)) throw new HttpError(403, 'Forbidden.');
      return { db: { from, rpc: state.rpc, storage: { from: () => ({ info: state.info, remove: state.remove, createSignedUrl: state.signed }) } }, profile: { id: 'profile-owner', role: state.role } };
    },
    requireSameOrigin: (request: Request) => { if (request.headers.get('origin') !== 'https://crm.example.com') throw new HttpError(403, 'Invalid origin.'); },
    apiError: (error: unknown) => Response.json({ error: error instanceof Error ? error.message : 'Failure' }, { status: error instanceof HttpError ? error.status : 500 }),
  };
});
import { POST as personPOST } from '@/app/api/data/person/route';
import { POST as filePOST, GET as fileGET } from '@/app/api/files/route';

const contact = '00000000-0000-4000-8000-000000000010';
const deal = '00000000-0000-4000-8000-000000000011';
const file = '00000000-0000-4000-8000-000000000012';
const row = (id: string, fields: Record<string, unknown> = {}) => ({ id, created_at: '2026-01-01T00:00:00Z', deleted_at: null, ...fields });
const many = (prefix: string, count: number, fields: Record<string, unknown> = {}) => Array.from({ length: count }, (_, i) => row(prefix + String(i).padStart(6, '0'), fields));
const request = (body: unknown) => new Request('https://crm.example.com/api/data/person', { method: 'POST', headers: { origin: 'https://crm.example.com', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  state.role = 'owner'; state.rows = { contacts: [row(contact)], deals: [row(deal, { contact_id: contact })] };
  state.rpc.mockReset().mockResolvedValue({ data: {projects:[],invoices:[],businesses:[],subscriptions:[]}, error: null });
  state.info.mockReset().mockResolvedValue({ data: { size: 100, contentType: 'application/pdf' }, error: null });
  state.remove.mockReset().mockResolvedValue({ data: [], error: null });
  state.signed.mockReset().mockResolvedValue({ data: { signedUrl: 'https://storage.example.com/object' }, error: null });
  state.fetch.mockReset().mockResolvedValue(new Response('%PDF-1.7\n' + 'x'.repeat(91)));
  vi.stubGlobal('fetch', state.fetch);
});

describe('personal data completeness', () => {
  it('exports every related record beyond PostgREST response limits, deduplicating links and removing quote bearer tokens', async () => {
    state.rows.activities = many('activity', 1201, { contact_id: contact, deal_id: deal, body: 'Fictional note' });
    state.rows.quotes = [row('quote', { deal_id: deal, public_token: 'never-export-a-bearer' })];
    state.rows.quote_items = many('item', 1201, { quote_id: 'quote' });
    const response = await personPOST(request({ contact_id: contact, action: 'export' }));
    expect(response.status).toBe(200);
    const output = await response.json();
    expect(output.activities).toHaveLength(1201); expect(output.quote_items).toHaveLength(1201);
    expect(output.quotes[0]).not.toHaveProperty('public_token');
    expect(state.rpc).toHaveBeenCalledExactlyOnceWith('person_data_scope', {p_contact_id:contact});
  });
  it('reports a safety limit instead of silently returning partial personal data', async () => {
    state.rows.activities = many('activity', 10001, { contact_id: contact });
    const response = await personPOST(request({ contact_id: contact, action: 'export' }));
    expect(response.status).toBe(413); expect((await response.json()).error).toContain('10,000');
  });
  it('blocks a staff personal export before any data is returned', async () => {
    state.role = 'staff';
    expect((await personPOST(request({ contact_id: contact, action: 'export' }))).status).toBe(403);
  });
  it('includes delivery and billing linked only through the person’s private business',async()=>{
    state.rpc.mockResolvedValue({data:{businesses:['business'],projects:['project'],invoices:['invoice'],subscriptions:['subscription']},error:null});
    state.rows.businesses=[row('business')];state.rows.projects=[row('project',{business_id:'business'})];
    state.rows.invoices=[row('invoice',{business_id:'business'})];state.rows.subscriptions=[row('subscription',{business_id:'business'})];
    state.rows.tasks=[row('project-task',{project_id:'project',title:'Project-only note'})];
    const response=await personPOST(request({contact_id:contact,action:'export'}));
    expect(response.status).toBe(200);const output=await response.json();
    expect(output.projects).toHaveLength(1);expect(output.invoices).toHaveLength(1);expect(output.subscriptions).toHaveLength(1);
    expect(output.tasks[0].title).toBe('Project-only note');
  });
});

describe('signed upload verification', () => {
  beforeEach(() => { state.rows.files = [row(file, { entity: 'deal', entity_id: deal, path: 'deal/' + deal + '/' + file + '.pdf', name: 'Example.pdf', mime: 'application/pdf', size: 100, uploaded_by: 'profile-owner', upload_status: 'pending' })]; });
  it.each([{ size: 101, contentType: 'application/pdf' }, { size: 100, contentType: 'text/html' }])('rejects mismatched stored object metadata %o and schedules cleanup', async metadata => {
    state.info.mockResolvedValue({ data: metadata, error: null });
    const response = await filePOST(request({ action: 'complete_upload', id: file }));
    expect(response.status).toBe(400);
    expect(state.rows.files[0].upload_status).toBe('pending');
    expect(state.rpc).toHaveBeenCalledWith('cancel_file_upload', { p_file_id: file });
    expect(state.remove).toHaveBeenCalled(); expect(state.fetch).not.toHaveBeenCalled();
  });
  it('rejects false PDF content even when the declared and stored metadata agree', async () => {
    state.fetch.mockResolvedValue(new Response('<html>not a PDF document</html>'));
    expect((await filePOST(request({ action: 'complete_upload', id: file }))).status).toBe(400);
    expect(state.rpc).toHaveBeenCalledWith('cancel_file_upload', { p_file_id: file });
  });
  it('marks a file ready only after stored size, MIME and signature checks pass', async () => {
    const response = await filePOST(request({ action: 'complete_upload', id: file }));
    expect(response.status).toBe(201); expect(state.rows.files[0].upload_status).toBe('ready');
    expect(state.fetch).toHaveBeenCalledWith('https://storage.example.com/object', expect.objectContaining({ headers: { Range: 'bytes=0-15' } }));
    expect(state.rpc).not.toHaveBeenCalled();
  });
  it('blocks completing another staff member’s pending upload', async () => {
    state.role = 'staff'; state.rows.files[0].uploaded_by = 'other-profile';
    expect((await filePOST(request({ action: 'complete_upload', id: file }))).status).toBe(403);
    expect(state.info).not.toHaveBeenCalled();
  });
  it('lists ready attachments beyond 500 without exposing pending uploads', async () => {
    state.rows.files = [...state.rows.files, ...many('ready', 601, { entity: 'deal', entity_id: deal, upload_status: 'ready' })];
    const response = await fileGET(new Request('https://crm.example.com/api/files?entity=deal&entity_id=' + deal));
    expect(response.status).toBe(200); expect((await response.json()).files).toHaveLength(601);
  });
});
