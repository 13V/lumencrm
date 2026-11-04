import { writeFile } from 'node:fs/promises';

/** Generate Row/Insert/Update and foreign-key types from the migrated PostgreSQL catalog. */
export async function generateTypes(db) {
  const {rows:columns}=await db.query("select table_name,column_name,udt_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='public' order by table_name,ordinal_position");
  const {rows:enums}=await db.query("select t.typname,e.enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public' order by t.typname,e.enumsortorder");
  const {rows:relationships}=await db.query("select tc.table_name,tc.constraint_name,kcu.column_name,ccu.table_name referenced_table,ccu.column_name referenced_column from information_schema.table_constraints tc join information_schema.key_column_usage kcu on tc.constraint_name=kcu.constraint_name and tc.table_schema=kcu.table_schema join information_schema.constraint_column_usage ccu on tc.constraint_name=ccu.constraint_name and tc.table_schema=ccu.table_schema where tc.constraint_type='FOREIGN KEY' and tc.table_schema='public' and ccu.table_schema='public' order by tc.table_name,tc.constraint_name");
  const tables=Object.groupBy(columns,c=>c.table_name);
  const enumGroups=Object.groupBy(enums,e=>e.typname);
  const resolve=(udt,dataType)=>{
    if(dataType==='ARRAY') return resolve(udt.slice(1),'')+'[]';
    if(enumGroups[udt]) return "Database['public']['Enums']['"+udt+"']";
    if(['int2','int4','int8','float4','float8','numeric'].includes(udt)) return 'number';
    if(udt==='bool') return 'boolean';
    if(['json','jsonb'].includes(udt)) return 'Json';
    return 'string';
  };
  const lines=[
    '// Generated from the PostgreSQL catalog after applying supabase/migrations.',
    '// Regenerate: node tests/database/run.mjs --types',
    '// A hosted Supabase CLI type export may replace this file without changing the schema.',
    'export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];',
    'export type Database = {',
    '  public: {',
    '    Tables: {'
  ];
  for(const [table,cols] of Object.entries(tables)) {
    lines.push('      '+table+': {');
    for(const kind of ['Row','Insert','Update']) {
      lines.push('        '+kind+': {');
      for(const c of cols) {
        const optional=kind==='Update'||(kind==='Insert'&&(c.column_default!==null||c.is_nullable==='YES'));
        lines.push('          '+c.column_name+(optional?'?':'')+': '+resolve(c.udt_name,c.data_type)+(c.is_nullable==='YES'?' | null':'')+';');
      }
      lines.push('        };');
    }
    const refs=relationships.filter(r=>r.table_name===table);
    lines.push('        Relationships: [');
    for(const r of refs) lines.push('          { foreignKeyName: '+JSON.stringify(r.constraint_name)+'; columns: ['+JSON.stringify(r.column_name)+']; isOneToOne: false; referencedRelation: '+JSON.stringify(r.referenced_table)+'; referencedColumns: ['+JSON.stringify(r.referenced_column)+']; },');
    lines.push('        ];','      };');
  }
  lines.push('    };','    Views: { [_ in never]: never };','    Functions: {');
  const {rows:functions}=await db.query("select p.proname,p.proargnames,p.proargtypes::oid[] arg_types,p.pronargdefaults,p.proretset,t.typname return_udt from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_type t on t.oid=p.prorettype where n.nspname='public' and t.typname<>'trigger' order by p.proname");
  const {rows:pgTypes}=await db.query('select oid,typname from pg_type');
  const pgTypeMap=Object.fromEntries(pgTypes.map(t=>[t.oid,t.typname]));
  const typeFor=udt=>tables[udt]?"Database['public']['Tables']['"+udt+"']['Row']":udt==='void'?'undefined':resolve(udt,udt.startsWith('_')?'ARRAY':'');
  for(const fn of functions) {
    const count=fn.arg_types.length;
    const args=count?'{ '+fn.arg_types.map((oid,i)=>fn.proargnames[i]+(i>=count-fn.pronargdefaults?'?':'')+': '+typeFor(pgTypeMap[oid])+(i>=count-fn.pronargdefaults?' | null':'')).join('; ')+' }':'Record<PropertyKey, never>';
    const returns=typeFor(fn.return_udt)+(fn.proretset?'[]':'');
    lines.push('      '+fn.proname+': { Args: '+args+'; Returns: '+returns+' };');
  }
  lines.push('    };','    Enums: {');
  for(const [name,values] of Object.entries(enumGroups)) lines.push('      '+name+': '+values.map(v=>JSON.stringify(v.enumlabel)).join(' | ')+';');
  lines.push('    };','    CompositeTypes: { [_ in never]: never };','  };','};',
    "export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];",
    "export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];",
    "export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'];",'');
  await writeFile('src/lib/database.types.ts',lines.join('\n'));
  console.log('Generated database.types.ts from '+Object.keys(tables).length+' migrated PostgreSQL tables.');
}
