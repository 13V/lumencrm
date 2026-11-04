import {readFile,writeFile} from 'node:fs/promises';
const source=await readFile('src/lib/demo.ts','utf8');
const people=JSON.parse(('['+source.match(/const PEOPLE = \[([\s\S]*?)\];/)[1].replaceAll("'",'"')+']').replace(/,\s*]/g,']'));
const phones=source.match(/const PHONES = \[([^\]]+)\]/)[1].split(',').map(v=>v.trim().slice(1,-1));
const sql=value=>"'"+String(value).replaceAll("'","''")+"'";
const tuples=people.map((person,i)=>'    ('+[i+1,...person,'+61'+phones[i].slice(1)].map(v=>typeof v==='number'?v:sql(v)).join(',')+')').join(',\n');
const template=await readFile('supabase/scripts/seed-template.sql','utf8');
await writeFile('supabase/seed.sql',template.replace('-- FIXTURE_VALUES',tuples));
console.log('Generated 30 fictional Adelaide leads. Seed is opt-in and refuses a non-empty contact/deal database.');
