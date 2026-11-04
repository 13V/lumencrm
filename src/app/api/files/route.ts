import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { apiError,HttpError,requireSameOrigin,requireSession } from '@/lib/server/auth';
import { noStore,readJson,type SessionDb } from '../data/shared';

const entitySchema=z.enum(['deal','contact','business','project','quote','invoice']);
type Entity=z.infer<typeof entitySchema>;
const tables:Record<Entity,string>={deal:'deals',contact:'contacts',business:'businesses',project:'projects',quote:'quotes',invoice:'invoices'};
const metadata='id,entity,entity_id,name,mime,size,created_at,updated_at,deleted_at,upload_status';
const maxFile=25*1024*1024;
const mimeExtensions:Record<string,string[]>={
  'image/jpeg':['jpg','jpeg'],'image/png':['png'],'image/webp':['webp'],'image/gif':['gif'],'image/heic':['heic'],'image/heif':['heif'],
  'image/svg+xml':['svg'],'application/pdf':['pdf'],'text/plain':['txt'],'text/csv':['csv'],
  'application/zip':['zip'],'application/vnd.openxmlformats-officedocument.wordprocessingml.document':['docx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['xlsx'],'application/vnd.openxmlformats-officedocument.presentationml.presentation':['pptx'],
};
async function checkEntity(db:SessionDb,role:string,entity:Entity,id:string,write=false) {
  if(role==='staff' && ['quote','invoice'].includes(entity)) throw new HttpError(403,'Financial files are available to the owner and viewers only.');
  if(write && role==='viewer') throw new HttpError(403,'Your account has read-only access.');
  const result=await db.from(tables[entity]).select('id').eq('id',id).is('deleted_at',null).maybeSingle();
  if(result.error || !result.data) throw new HttpError(404,'The linked record could not be found.');
}
function checkSignature(bytes:Uint8Array,mime:string) {
  const text=(from:number,to:number)=>String.fromCharCode(...bytes.slice(from,to));
  if(mime==='application/pdf' && text(0,5)!=='%PDF-') throw new HttpError(400,'This file does not match its PDF type.');
  if(mime==='image/jpeg' && !(bytes[0]===0xff && bytes[1]===0xd8 && bytes[2]===0xff)) throw new HttpError(400,'This file does not match its JPEG type.');
  if(mime==='image/png' && !(bytes[0]===0x89 && text(1,4)==='PNG')) throw new HttpError(400,'This file does not match its PNG type.');
  if(mime==='image/gif' && !['GIF87a','GIF89a'].includes(text(0,6))) throw new HttpError(400,'This file does not match its GIF type.');
  if(mime==='image/webp' && !(text(0,4)==='RIFF' && text(8,12)==='WEBP')) throw new HttpError(400,'This file does not match its WebP type.');
  if((mime==='application/zip' || mime.includes('officedocument')) && text(0,2)!=='PK') throw new HttpError(400,'This file does not match its archive type.');
}
function fileDetails(original:string,mime:string,size:number) {
  if(size<1 || size>maxFile) throw new HttpError(413,'Upload a non-empty file no larger than 25 MB.');
  const name=original.split(/[\\/]/).pop()!.replace(/[\x00-\x1f\x7f]/g,'').slice(0,180).trim();
  const extension=name.split('.').pop()?.toLowerCase() || '';
  if(!name || !mimeExtensions[mime]?.includes(extension)) throw new HttpError(400,'Use an image, PDF, text, CSV, Office document or ZIP with a matching file extension.');
  return {name,extension};
}
async function storedSignature(db:SessionDb,path:string,mime:string) {
  if(!['application/pdf','image/jpeg','image/png','image/webp','image/gif','application/zip'].includes(mime) && !mime.includes('officedocument')) return;
  const signed=await db.storage.from('crm-files').createSignedUrl(path,60);
  if(signed.error || !signed.data) throw new HttpError(503,'The uploaded file could not be checked.');
  const response=await fetch(signed.data.signedUrl,{headers:{Range:'bytes=0-15'},cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(!response.ok || !response.body) throw new HttpError(503,'The uploaded file could not be checked.');
  const reader=response.body.getReader(),prefix=new Uint8Array(16);let length=0;
  while(length<16) {
    const part=await reader.read();if(part.done) break;
    const needed=part.value.slice(0,16-length);prefix.set(needed,length);length+=needed.length;
  }
  await reader.cancel();
  if(!length) throw new HttpError(400,'The uploaded file is empty.');
  checkSignature(prefix.slice(0,length),mime);
}
export async function GET(request:Request) {
  try {
    const {db,profile}=await requireSession();const query=new URL(request.url).searchParams;
    const fileId=query.get('id');
    if(fileId) {
      if(!z.uuid().safeParse(fileId).success) throw new HttpError(400,'Choose a valid file.');
      const result=await db.from('files').select('*').eq('id',fileId).eq('upload_status','ready').is('deleted_at',null).single();
      if(result.error || !result.data) throw new HttpError(404,'The file could not be found.');
      const file=result.data;await checkEntity(db,profile.role,file.entity as Entity,file.entity_id);
      const signed=await db.storage.from('crm-files').createSignedUrl(file.path,60,{download:file.name});
      if(signed.error || !signed.data) throw new HttpError(503,'The download link could not be created.');
      return Response.json({url:signed.data.signedUrl,expires_in:60},{headers:noStore});
    }
    const parsed=z.object({entity:entitySchema,entity_id:z.uuid()}).safeParse({entity:query.get('entity'),entity_id:query.get('entity_id')});
    if(!parsed.success) throw new HttpError(400,'Choose the linked record.');
    await checkEntity(db,profile.role,parsed.data.entity,parsed.data.entity_id);
    const files:Record<string,unknown>[]=[];let cursor:string|undefined;
    for(;;) {
      let query=db.from('files').select(metadata).eq('entity',parsed.data.entity).eq('entity_id',parsed.data.entity_id).eq('upload_status','ready').is('deleted_at',null).order('id',{ascending:true}).limit(500);
      if(cursor) query=query.gt('id',cursor);
      const result=await query;if(result.error) throw new HttpError(503,'Files could not be loaded.');
      const rows=(result.data || []) as Record<string,unknown>[];files.push(...rows);
      if(files.length>10000) throw new HttpError(413,'This record has more than 10,000 files. Export file metadata to inspect the complete list.');
      if(rows.length<500) break;cursor=String(rows.at(-1)!.id);
    }
    files.sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)));
    return Response.json({files},{headers:noStore});
  } catch(error) { return apiError(error); }
}
export async function POST(request:Request) {
  try {
    requireSameOrigin(request);const {db,profile}=await requireSession(['owner','staff']);
    if(request.headers.get('content-type')?.includes('application/json')) {
      const input=z.discriminatedUnion('action',[
        z.object({action:z.literal('prepare_upload'),entity:entitySchema,entity_id:z.uuid(),name:z.string().min(1).max(300),mime:z.string().max(150),size:z.number().int().positive().max(maxFile)}).strict(),
        z.object({action:z.literal('complete_upload'),id:z.uuid()}).strict(),
      ]).safeParse(await readJson(request,2000));
      if(!input.success) throw new HttpError(400,'Check the upload details and the 25 MB file limit.');
      if(input.data.action==='prepare_upload') {
        const {entity,entity_id,mime,size}=input.data,{name,extension}=fileDetails(input.data.name,mime,size);
        await checkEntity(db,profile.role,entity,entity_id,true);
        const id=randomUUID(),path=entity+'/'+entity_id+'/'+id+'.'+extension;
        const record=await db.from('files').insert({id,entity,entity_id,path,name,mime,size,upload_status:'pending',uploaded_by:profile.id}).select('id').single();
        if(record.error) throw new HttpError(503,'The upload could not be prepared.');
        const signed=await db.storage.from('crm-files').createSignedUploadUrl(path);
        if(signed.error || !signed.data) { await db.rpc('cancel_file_upload',{p_file_id:id});throw new HttpError(503,'The upload link could not be created.'); }
        return Response.json({id,path,token:signed.data.token},{headers:noStore});
      }
      const record=await db.from('files').select('*').eq('id',input.data.id).is('deleted_at',null).single();
      if(record.error || !record.data) throw new HttpError(404,'The upload could not be found.');
      const file=record.data;
      if(profile.role!=='owner' && file.uploaded_by!==profile.id) throw new HttpError(403,'Only the person who started this upload can complete it.');
      await checkEntity(db,profile.role,file.entity as Entity,file.entity_id,true);
      if(file.upload_status==='ready') { const {path:_path,...safe}=file;return Response.json({file:safe},{headers:noStore}); }
      if(file.upload_status!=='pending') throw new HttpError(400,'Start a new upload for this file.');
      const info=await db.storage.from('crm-files').info(file.path);
      if(info.error || !info.data) throw new HttpError(400,'The file has not finished uploading. Try completing it again.');
      try {
        if(info.data.size!==file.size || info.data.contentType!==file.mime) throw new HttpError(400,'The uploaded file size or type does not match the prepared upload.');
        await storedSignature(db,file.path,file.mime);
      } catch(error) {
        if(error instanceof HttpError && error.status===400) { await db.storage.from('crm-files').remove([file.path]);await db.rpc('cancel_file_upload',{p_file_id:file.id}); }
        throw error;
      }
      const saved=await db.from('files').update({upload_status:'ready'}).eq('id',file.id).eq('upload_status','pending').select(metadata).single();
      if(saved.error || !saved.data) throw new HttpError(503,'File details could not be confirmed. Try completing this upload again.');
      return Response.json({file:saved.data},{status:201,headers:noStore});
    }
    if(Number(request.headers.get('content-length'))>maxFile+65536) throw new HttpError(413,'Upload a file no larger than 25 MB.');
    const form=await request.formData(),file=form.get('file');
    const input=z.object({entity:entitySchema,entity_id:z.uuid()}).safeParse({entity:form.get('entity'),entity_id:form.get('entity_id')});
    if(!input.success || !(file instanceof File)) throw new HttpError(400,'Choose a file and its linked record.');
    const mime=file.type.toLowerCase(),{name,extension}=fileDetails(file.name,mime,file.size);
    await checkEntity(db,profile.role,input.data.entity,input.data.entity_id,true);
    const data=new Uint8Array(await file.arrayBuffer());checkSignature(data,mime);
    const id=randomUUID(),path=input.data.entity+'/'+input.data.entity_id+'/'+id+'.'+extension;
    const record=await db.from('files').insert({id,entity:input.data.entity,entity_id:input.data.entity_id,path,name,mime,size:file.size,uploaded_by:profile.id,upload_status:'pending'}).select('id').single();
    if(record.error || !record.data) throw new HttpError(503,'File details could not be prepared.');
    const upload=await db.storage.from('crm-files').upload(path,data,{contentType:mime,upsert:false,cacheControl:'0'});
    if(upload.error) { await db.rpc('cancel_file_upload',{p_file_id:id});throw new HttpError(503,'The upload could not be saved.'); }
    const saved=await db.from('files').update({upload_status:'ready'}).eq('id',id).eq('upload_status','pending').select(metadata).single();
    if(saved.error || !saved.data) throw new HttpError(503,'File details could not be confirmed. Unfinished uploads are removed automatically.');
    return Response.json({file:saved.data},{status:201,headers:noStore});
  } catch(error) { return apiError(error); }
}
export async function DELETE(request:Request) {
  try {
    requireSameOrigin(request);const {db}=await requireSession(['owner']);
    const input=z.object({id:z.uuid()}).strict().safeParse(await readJson(request,1000));
    if(!input.success) throw new HttpError(400,'Choose a valid file.');
    const result=await db.from('files').update({deleted_at:new Date().toISOString()}).eq('id',input.data.id).is('deleted_at',null).select('id').maybeSingle();
    if(result.error || !result.data) throw new HttpError(404,'The file could not be found.');
    return Response.json({ok:true,undo:{entity:'files',id:input.data.id}},{headers:noStore});
  } catch(error) { return apiError(error); }
}
