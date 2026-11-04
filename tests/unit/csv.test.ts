import { describe,expect,it } from 'vitest';
import { CsvError,exportCsv,parseCsv,previewImport,suggestMapping,zipEntries } from '@/lib/domain/csv';

describe('CSV parsing and previews',()=>{
  it('preserves leading phone zeros, quoted commas, quotes and newlines',()=>{
    const parsed=parseCsv('\uFEFFName,Phone,Notes\r\n"Dave Example","0491570156","Line one, with comma\r\nHe said ""hello""."\r\n');
    expect(parsed.rows[0]).toEqual(['Dave Example','0491570156','Line one, with comma\r\nHe said "hello".']);
    expect(previewImport(parsed,suggestMapping(parsed.headers))[0].input.phone_e164).toBe('+61491570156');
  });
  it('rejects duplicate headers and malformed CSV before any row is accepted',()=>{
    expect(()=>parseCsv('Name,name\nA,B')).toThrow(/unique/);
    expect(()=>parseCsv('Name,Email\n"Missing quote,email@example.com')).toThrow(/closing quote/);
    expect(()=>parseCsv('Name,Email\nDave,dave@example.com,extra')).toThrow(/same number/);
    expect(()=>parseCsv('Name,Email\n"Dave"oops,dave@example.com')).toThrow(/Unexpected text/);
  });
  it('limits records and individual cells',()=>{
    expect(()=>parseCsv('Name,Email\n'+Array.from({length:1001},(_,i)=>'Person,person'+i+'@example.com').join('\n'))).toThrow(/1,000/);
    expect(()=>parseCsv('Name\n'+ 'x'.repeat(10001))).toThrow(/10,000/);
    expect(()=>parseCsv('x'.repeat(2_000_001))).toThrow(CsvError);
  });
  it('maps AU dates explicitly and normalises phone and email',()=>{
    const table=parseCsv('Name,Mobile,Email,Created date\nDave Example,0491 570 156,DAVE@EXAMPLE.COM,03/11/2026');
    const [row]=previewImport(table,suggestMapping(table.headers));
    expect(row.errors).toEqual([]);
    expect(row.input).toMatchObject({first_name:'Dave',last_name:'Example',phone_e164:'+61491570156',email:'dave@example.com',received_at:'2026-11-02T22:30:00.000Z'});
  });
  it('reports field errors without coercing invalid phones or dates',()=>{
    const table=parseCsv('Name,Phone,Email,Created date\nDave,491570156,bad,31/02/2026');
    const row=previewImport(table,suggestMapping(table.headers))[0];
    expect(row.errors.map(error=>error.field)).toContain('email');
    expect(row.errors.map(error=>error.field)).toContain('created_at');
  });
  it('requires an explicit historical win reason and a real sent quote',()=>{
    const table=parseCsv('Name,Email,Stage\nDave,dave@example.com,Won\nPat,pat@example.com,Quote sent');
    const rows=previewImport(table,suggestMapping(table.headers));
    expect(rows[0].errors.some(error=>error.field==='override_reason')).toBe(true);
    expect(rows[1].errors.some(error=>error.field==='stage_key')).toBe(true);
  });
  it('contact-only import ignores deal stages and requires mapped identity',()=>{
    const table=parseCsv('Name,Email,Stage\nDave,dave@example.com,Won');
    expect(previewImport(table,suggestMapping(table.headers),'contacts')[0].errors).toEqual([]);
    expect(()=>previewImport(table,{name:'Name'})).toThrow(/Phone or Email/);
    expect(()=>previewImport(table,{name:'Missing',email:'Email'})).toThrow(/does not exist/);
  });
});
describe('CSV exports',()=>{
  it('escapes spreadsheet formulas while preserving data and negative numeric values',()=>{
    const csv=exportCsv([{name:'=HYPERLINK("https://example.com")',phone:'+61491570156',notes:'  @SUM(1)',amount:-10,quote:'Say "hello"\nNext'}]);
    expect(csv).toContain('"\'=HYPERLINK(""https://example.com"")"');
    expect(csv).toContain('"\'+61491570156"');
    expect(csv).toContain('"\'  @SUM(1)"');
    expect(csv).toContain('"-10"');
    const parsed=parseCsv(csv);
    expect(parsed.rows[0][4]).toBe('Say "hello"\nNext');
  });
  it('exports JSON fields as quoted data and returns an empty CSV safely',()=>{
    expect(exportCsv([{data:{trade:'Plumber'}}])).toContain('"{""trade"":""Plumber""}"');
    expect(exportCsv([],['name','email'])).toContain('"name","email"');
  });
  it('creates a valid stored ZIP layout with UTF-8 names, CRC and a central directory',()=>{
    const zip=zipEntries([{name:'contacts.csv',content:'hello'}]);
    const data=new DataView(zip.buffer);
    expect(data.getUint32(0,true)).toBe(0x04034b50);
    expect(data.getUint32(14,true)).toBe(0x3610a686);
    const nameLength=data.getUint16(26,true);
    expect(new TextDecoder().decode(zip.slice(30+nameLength,30+nameLength+5))).toBe('hello');
    expect(data.getUint32(zip.length-22,true)).toBe(0x06054b50);
    expect(data.getUint16(zip.length-14,true)).toBe(1);
    expect(()=>zipEntries([{name:'../private.csv',content:''}])).toThrow(/Invalid/);
  });
});
