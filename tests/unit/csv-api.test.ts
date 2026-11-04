import { beforeEach,describe,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({role:'owner',rpc:vi.fn(),from:vi.fn(),requireSession:vi.fn()}));
vi.mock('@/lib/server/auth',()=>{
  class HttpError extends Error {constructor(public status:number,message:string){super(message);}}
  return {
    HttpError,
    requireSameOrigin:(request:Request)=>{if(request.headers.get('origin')!=='https://crm.example.com') throw new HttpError(403,'Invalid origin.');},
    requireSession:async(roles:string[]=[])=>{mocks.requireSession(roles);if(!roles.includes(mocks.role)) throw new HttpError(403,'Forbidden.');return {db:{rpc:mocks.rpc,from:mocks.from},profile:{role:mocks.role,id:'owner'}};},
    apiError:(error:unknown)=>Response.json({error:error instanceof Error?error.message:'Failure'},{status:error instanceof HttpError?error.status:500}),
  };
});
import { POST } from '@/app/api/data/import/route';
import { GET as exportGET } from '@/app/api/data/export/route';
import { POST as filePOST } from '@/app/api/files/route';
function request(body:Record<string,unknown>){return new Request('https://crm.example.com/api/data/import',{method:'POST',headers:{origin:'https://crm.example.com','Content-Type':'application/json'},body:JSON.stringify(body)});}
function query() {
  const chain:Record<string,unknown>={then:(resolve:(result:unknown)=>unknown)=>Promise.resolve({data:[],error:null}).then(resolve)};
  for(const name of ['select','in','eq','is','order','range','gte','lt']) chain[name]=()=>chain;
  return chain;
}
describe('CSV HTTP boundary',()=>{
  beforeEach(()=>{mocks.role='owner';mocks.rpc.mockReset();mocks.from.mockReset();mocks.requireSession.mockClear();mocks.from.mockImplementation(query);mocks.rpc.mockImplementation(async(name:string,args:Record<string,unknown>)=>name==='prepare_import_batch'?{data:{id:args.p_id},error:null}:{data:[{row:2,skipped:false}],error:null});});
  it('dry run validates and checks matches without writing',async()=>{
    const response=await POST(request({csv:'Name,Phone\nDave,0491570156',dry_run:true}));
    expect(response.status).toBe(200);
    const body=await response.json();expect(body.valid_count).toBe(1);expect(body.request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.rows[0].input.phone_e164).toBe('+61491570156');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('cannot execute without the preview request id or with invalid rows',async()=>{
    expect((await POST(request({csv:'Name,Phone\nDave,0491570156',dry_run:false}))).status).toBe(400);
    expect((await POST(request({csv:'Name,Email\nDave,invalid',dry_run:false,request_id:'00000000-0000-4000-8000-000000000090'}))).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('commits with durable batch and row hashes and supports retries',async()=>{
    const response=await POST(request({csv:'Name,Phone\nDave,0491570156',dry_run:false,request_id:'00000000-0000-4000-8000-000000000090'}));
    expect(response.status).toBe(200);expect((await response.json()).imported).toBe(1);
    expect(mocks.rpc.mock.calls[0][0]).toBe('prepare_import_batch');
    expect(mocks.rpc.mock.calls[0][1].p_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.rpc.mock.calls[1][0]).toBe('import_lead_rows');
    expect(mocks.rpc.mock.calls[1][1].p_rows[0].hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('blocks staff and viewers from both imports and exports before querying data',async()=>{
    for(const role of ['staff','viewer']) {
      mocks.role=role;
      expect((await POST(request({csv:'Name,Email\nDave,dave@example.com',dry_run:true}))).status).toBe(403);
      expect((await exportGET(new Request('https://crm.example.com/api/data/export?entity=contacts'))).status).toBe(403);
    }
    expect(mocks.from).not.toHaveBeenCalled();expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects oversized payloads and unsupported table exports',async()=>{
    expect((await POST(request({csv:'x'.repeat(2_100_001),dry_run:true}))).status).toBe(413);
    expect((await exportGET(new Request('https://crm.example.com/api/data/export?entity=auth.users'))).status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('rejects financial file uploads by staff, viewer uploads and unsupported file types',async()=>{
    const prepare={action:'prepare_upload',entity:'invoice',entity_id:'00000000-0000-4000-8000-000000000091',name:'invoice.pdf',mime:'application/pdf',size:100};
    mocks.role='staff';expect((await filePOST(request(prepare))).status).toBe(403);
    mocks.role='viewer';expect((await filePOST(request({...prepare,entity:'deal'}))).status).toBe(403);
    mocks.role='owner';expect((await filePOST(request({...prepare,name:'script.html',mime:'text/html'}))).status).toBe(400);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
