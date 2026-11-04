import { z } from 'zod';
import { apiError, HttpError, requireSession, requireSameOrigin } from '@/lib/server/auth';
import { cleanExport,downloadResponse,noStore,readJson,type SessionDb } from '../shared';
export const maxDuration=60;
async function related(db:SessionDb,table:string,field:string,ids:string[]) {
  if(!ids.length) return [];
  const found=new Map<string,Record<string,unknown>>(),uniqueIds=[...new Set(ids)];
  for(let offset=0;offset<uniqueIds.length;offset+=100) {
    let cursor:string|undefined;
    for(;;) {
      let query=db.from(table).select('*').in(field,uniqueIds.slice(offset,offset+100)).order('id',{ascending:true}).limit(500);
      if(cursor) query=query.gt('id',cursor);
      const result=await query;
      if(result.error) throw new HttpError(503,'The personal data export could not be completed.');
      const rows=(result.data || []) as Record<string,unknown>[];
      for(const row of rows) found.set(String(row.id),cleanExport(row));
      if(found.size>10000) throw new HttpError(413,'This person has more than 10,000 related records in '+table+'. Export the relevant table separately.');
      if(rows.length<500) break;
      cursor=String(rows.at(-1)!.id);
    }
  }
  return [...found.values()];
}
export async function POST(request:Request) {
  try {
    requireSameOrigin(request);const {db,profile}=await requireSession(['owner']);
    const input=z.object({contact_id:z.uuid(),action:z.enum(['export','anonymise'])}).strict().safeParse(await readJson(request,1000));
    if(!input.success) throw new HttpError(400,'Choose a person and an action.');
    const {contact_id,action}=input.data;
    const result=await db.from('contacts').select('*').eq('id',contact_id).single();
    if(result.error || !result.data) throw new HttpError(404,'This person could not be found.');
    if(action==='export') {
      const scoped=await db.rpc('person_data_scope',{p_contact_id:contact_id});
      if(scoped.error || !scoped.data) throw new HttpError(503,'The full personal data scope could not be loaded.');
      const scope=scoped.data as Record<string,string[]>;
      const contact=result.data, deals=await related(db,'deals','contact_id',[contact_id]),dealIds=deals.map(row=>String(row.id));
      const [business,activities,contactActivities,tasks,contactTasks,appointments,contactAppointments,consents,demos,attribution,milestones,quotes,projects,invoices,contactInvoices,drafts]=await Promise.all([
        related(db,'businesses','id',[...(scope.businesses || []),...(contact.business_id?[contact.business_id]:[])]),related(db,'activities','deal_id',dealIds),related(db,'activities','contact_id',[contact_id]),
        related(db,'tasks','deal_id',dealIds),related(db,'tasks','contact_id',[contact_id]),related(db,'appointments','deal_id',dealIds),related(db,'appointments','contact_id',[contact_id]),
        related(db,'consents','contact_id',[contact_id]),related(db,'demos','deal_id',dealIds),related(db,'attribution','deal_id',dealIds),related(db,'deal_milestones','deal_id',dealIds),
        related(db,'quotes','deal_id',dealIds),related(db,'projects','id',scope.projects || []),related(db,'invoices','id',scope.invoices || []),related(db,'invoices','contact_id',[contact_id]),related(db,'message_drafts','contact_id',[contact_id]),
      ]);
      const unique=(rows:Record<string,unknown>[])=>[...new Map(rows.map(row=>[row.id,row])).values()];
      const allInvoices=unique([...invoices,...contactInvoices]),quoteIds=quotes.map(row=>String(row.id)),projectIds=projects.map(row=>String(row.id)),invoiceIds=allInvoices.map(row=>String(row.id));
      const [quoteItems,invoiceItems,payments,checklist,projectTasks,subscriptions,invoiceActivities,projectActivities,invoiceDrafts,overdueTasks]=await Promise.all([
        related(db,'quote_items','quote_id',quoteIds),related(db,'invoice_items','invoice_id',invoiceIds),related(db,'payments','invoice_id',invoiceIds),related(db,'checklist_items','project_id',projectIds),
        related(db,'tasks','project_id',projectIds),related(db,'subscriptions','id',scope.subscriptions || []),related(db,'activities','meta->>invoice_id',invoiceIds),
        related(db,'activities','meta->>project_id',projectIds),related(db,'message_drafts','invoice_id',invoiceIds),related(db,'tasks','rule_key',invoiceIds.map(id=>'invoice_overdue:'+id)),
      ]);
      const entityIds=[contact_id,...dealIds,...quoteIds,...projectIds,...invoiceIds,...(scope.subscriptions || []),...business.map(row=>String(row.id))];
      const files=await related(db,'files','entity_id',entityIds),taggings=await related(db,'taggings','entity_id',[...entityIds,...files.map(row=>String(row.id))]);
      const tags=await related(db,'tags','id',taggings.map(row=>String(row.tag_id)));
      const output={exported_at:new Date().toISOString(),contact:cleanExport(contact),business,deals,activities:unique([...activities,...contactActivities,...invoiceActivities,...projectActivities]),tasks:unique([...tasks,...contactTasks,...projectTasks,...overdueTasks]),appointments:unique([...appointments,...contactAppointments]),consents,demos,attribution,milestones,quotes,quote_items:quoteItems,projects,checklist_items:checklist,subscriptions,invoices:allInvoices,invoice_items:invoiceItems,payments,message_drafts:unique([...drafts,...invoiceDrafts]),taggings,tags,files:files.map(({path:_path,...file})=>file)};
      return downloadResponse(db,profile.id,'lumen-person-'+contact_id+'.json',JSON.stringify(output,null,2),'application/json; charset=utf-8');
    }
    const pathsResult=await db.rpc('person_storage_paths',{p_contact_id:contact_id});
    if(pathsResult.error) throw new HttpError(503,'File cleanup could not be prepared. Personal data has not been removed.');
    const paths=(pathsResult.data || []) as string[];
    const removed=await db.rpc('anonymise_contact',{p_contact_id:contact_id});
    if(removed.error) throw new HttpError(400,'Personal data could not be removed.');
    let count=0,pending=0;
    for(let offset=0;offset<paths.length;offset+=100) {
      const group=paths.slice(offset,offset+100),deletion=await db.storage.from('crm-files').remove(group);
      if(deletion.error) { pending+=group.length;continue; }
      const marked=await db.rpc('mark_storage_deleted',{p_paths:group});
      if(marked.error) pending+=group.length;else count+=group.length;
    }
    return Response.json(pending?{ok:false,personal_data_removed:true,files_removed:count,files_pending:pending,error:'Personal fields were removed. Some private files could not be confirmed deleted; retry this action or let the cleanup job retry.'}:{ok:true,personal_data_removed:true,files_removed:count},{status:pending?207:200,headers:noStore});
  } catch(error) { return apiError(error); }
}
