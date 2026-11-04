import { z } from 'zod';
import { fromZonedTime } from 'date-fns-tz';
import { normalizeEmail, normalizePhone } from './phone';

export const CSV_MAX_ROWS = 1000;
export const CSV_MAX_BYTES = 2_000_000;
export class CsvError extends Error {}
export interface CsvTable { headers: string[]; rows: string[][] }

/** RFC 4180 parser. Values stay strings so 0491… and postcodes retain their zeros. */
export function parseCsv(input: string): CsvTable {
  if (new TextEncoder().encode(input).length > CSV_MAX_BYTES) throw new CsvError('The CSV must be smaller than 2 MB.');
  const text = input.replace(/^\uFEFF/, '');
  if (text.includes('\0')) throw new CsvError('The CSV contains an unsupported null character.');
  const records: string[][] = [];
  let row: string[] = [], cell = '', quoted = false, closed = false;
  const pushCell = () => { if (cell.length > 10000) throw new CsvError('A cell exceeds 10,000 characters.'); row.push(cell); cell = ''; closed = false; if (row.length > 100) throw new CsvError('Use at most 100 columns.'); };
  const pushRow = () => { pushCell(); if (row.some(value => value.trim())) records.push(row); row = []; if (records.length > CSV_MAX_ROWS + 1) throw new CsvError('Import at most 1,000 rows at a time.'); };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; closed = true; } }
      else cell += char;
    } else if (char === ',') pushCell();
    else if (char === '\n' || char === '\r') { if (char === '\r' && text[i + 1] === '\n') i++; pushRow(); }
    else if (char === '"' && !cell && !closed) quoted = true;
    else if (closed) { if (char !== ' ' && char !== '\t') throw new CsvError('Unexpected text after a quoted value.'); }
    else if (char === '"') throw new CsvError('Quotes inside a value must use CSV double-quote escaping.');
    else cell += char;
    if (cell.length > 10000) throw new CsvError('A cell exceeds 10,000 characters.');
  }
  if (quoted) throw new CsvError('A quoted value is missing its closing quote.');
  if (cell || row.length || closed) pushRow();
  if (!records.length) throw new CsvError('Add a header row and at least one data row.');
  const headers = records.shift()!.map(header => header.trim());
  if (headers.some(header => !header || header.length > 200)) throw new CsvError('Every column needs a unique header of at most 200 characters.');
  if (new Set(headers.map(header => header.toLowerCase())).size !== headers.length) throw new CsvError('Column headers must be unique.');
  if (records.some(values => values.length !== headers.length)) throw new CsvError('Each row must have the same number of columns as the header.');
  return { headers, rows: records };
}

export const IMPORT_FIELDS = ['name','first_name','last_name','phone','email','business','trade','suburb','website','notes','channel','stage_key','outcome','lost_reason','override_reason','value_once','value_monthly','presales_minutes','demo_build_minutes','created_at','first_touch_at','two_way_at','next_step','next_step_at','promised_text','promised_due_at'] as const;
export type ImportField = typeof IMPORT_FIELDS[number];
export type CsvMapping = Partial<Record<ImportField, string>>;
export interface ImportPreviewRow { row: number; input: Record<string, string | number | null>; errors: { field: string; message: string }[] }
const aliases: Partial<Record<ImportField, string[]>> = {
  name: ['name','full name','full_name'], first_name: ['first name','first_name'], last_name: ['last name','last_name'],
  phone: ['phone','phone_number','mobile','mobile number'], email: ['email','email address'], business: ['business','business name','company','company_name'],
  trade: ['trade','your trade'], suburb: ['suburb','city'], website: ['website','website_url'], notes: ['notes','message'], channel: ['channel','source'],
  stage_key: ['stage','stage_key'], outcome: ['outcome'], lost_reason: ['lost reason','lost_reason'], override_reason: ['override_reason','win reason'],
  value_once: ['value_once','quote value','won value'], value_monthly: ['value_monthly','monthly fee'], presales_minutes: ['presales_minutes','presales minutes'],
  demo_build_minutes: ['demo_build_minutes','demo build minutes'], created_at: ['created_at','received_at','created_time','created date'],
  first_touch_at: ['first_touch_at'], two_way_at: ['two_way_at'], next_step: ['next_step','next step'], next_step_at: ['next_step_at','next step date'],
  promised_text: ['promised_text','promise'], promised_due_at: ['promised_due_at','promised date'],
};
export function suggestMapping(headers: string[]): CsvMapping {
  return Object.fromEntries(IMPORT_FIELDS.flatMap(field => {
    const header = headers.find(value => aliases[field]?.includes(value.toLowerCase().trim()));
    return header ? [[field, header]] : [];
  })) as CsvMapping;
}
const stageAliases: Record<string, string> = { new:'new',contacted:'contacted','two-way contact':'contacted',suitable:'suitable','call booked':'call_booked',call_booked:'call_booked','brief agreed':'brief',brief:'brief','demo sent':'demo',demo:'demo','quote sent':'quote',quote:'quote',won:'won','deposit / won':'won' };
const outcomeAliases: Record<string, string> = { open:'open',won:'won',lost:'lost','not suitable':'unsuitable',unsuitable:'unsuitable','no reply':'noreply',noreply:'noreply' };
const channels = new Set(['website','meta_form','chloe','referral','phone','business_card','manual','other']);
function importedDate(value: string): string | null {
  if (!value) return null;
  const au = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const isoDay = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : au ? [au[3],au[2].padStart(2,'0'),au[1].padStart(2,'0')].join('-') : null;
  if (isoDay) {
    const check = new Date(isoDay + 'T12:00:00Z');
    if (!Number.isFinite(check.getTime()) || check.toISOString().slice(0,10) !== isoDay) return null;
    return fromZonedTime(isoDay + 'T09:00:00','Australia/Adelaide').toISOString();
  }
  if (!z.iso.datetime({ offset: true }).safeParse(value).success) return null;
  const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
export function previewImport(table: CsvTable, mapping: CsvMapping, entity: 'contacts' | 'deals' = 'deals'): ImportPreviewRow[] {
  if (Object.keys(mapping).some(key => !IMPORT_FIELDS.includes(key as ImportField))) throw new CsvError('The column mapping contains an unsupported field.');
  const used = Object.values(mapping).filter(Boolean);
  if (used.some(header => !table.headers.includes(header!))) throw new CsvError('A mapped column does not exist in this CSV.');
  if (new Set(used).size !== used.length) throw new CsvError('Map each CSV column to only one field.');
  if (!mapping.name && !mapping.first_name) throw new CsvError('Map a Name or First name column.');
  if (!mapping.phone && !mapping.email) throw new CsvError('Map a Phone or Email column.');
  return table.rows.map((values, index) => {
    const row: Record<string, string> = {};
    for (const [field, header] of Object.entries(mapping)) if (header) row[field] = values[table.headers.indexOf(header)].trim();
    const errors: ImportPreviewRow['errors'] = [];
    const error = (field: string, message: string) => errors.push({ field, message });
    const name = row.first_name || row.name?.split(/\s+/)[0] || '';
    const last = row.last_name || (!row.first_name ? row.name?.split(/\s+/).slice(1).join(' ') : '') || '';
    if (!name || name.length > 200 || last.length > 200) error('name','Add a name of at most 200 characters.');
    const phone = row.phone ? normalizePhone(row.phone) : null, email = row.email ? normalizeEmail(row.email) : null;
    if (row.phone && !phone) error('phone','Enter a valid phone number. Preserve its leading zero or use +61.');
    if (row.email && (!email || row.email.length > 254)) error('email','Enter a valid email address.');
    if (!phone && !email) error('phone','A valid phone number or email is required.');
    const input: ImportPreviewRow['input'] = { first_name:name,last_name:last,phone_e164:phone,phone_display:row.phone || null,email,business:row.business || null,trade:row.trade || null,suburb:row.suburb || null,website:row.website || null,message:row.notes || null,entity };
    for (const field of ['business','trade','suburb'] as const) if ((row[field]?.length || 0) > 200) error(field,'Use at most 200 characters.');
    if ((row.notes?.length || 0) > 5000) error('notes','Use at most 5,000 characters.');
    if (row.website && !z.url({ protocol:/^https?$/ }).safeParse(row.website).success) error('website','Use a complete http or https website address.');
    if (entity === 'deals') {
      const stage = row.stage_key ? stageAliases[row.stage_key.toLowerCase()] : 'new';
      const outcome = row.outcome ? outcomeAliases[row.outcome.toLowerCase()] : stage === 'won' ? 'won' : 'open';
      const channel = (row.channel || 'manual').toLowerCase().replaceAll(' ','_');
      if (!stage) error('stage_key','Use a configured sales stage.');
      if (!outcome) error('outcome','Use Open, Won, Lost, Not suitable or No reply.');
      if (!channels.has(channel)) error('channel','Use website, meta_form, chloe, referral, phone, business_card, manual or other.');
      if (stage === 'quote') error('stage_key','Import this row at Demo sent, then create or link its sent quote before moving to Quote sent.');
      if ((stage === 'won' || outcome === 'won') && (row.override_reason?.length || 0) < 5) error('override_reason','Record why this historical win is being imported without an accepted CRM quote.');
      Object.assign(input,{stage_key:stage || 'new',outcome:outcome || 'open',channel,lost_reason:row.lost_reason || null,override_reason:row.override_reason || null,next_step:row.next_step || null,promised_text:row.promised_text || null});
      for (const field of ['value_once','value_monthly','presales_minutes','demo_build_minutes'] as const) {
        const raw = row[field]?.replace(/[$,\s]/g,'');
        if (!raw) continue;
        const number = Number(raw);
        if (!Number.isFinite(number) || number < 0 || number > 99999999 || (field.endsWith('minutes') && !Number.isInteger(number))) error(field,'Use a non-negative number; time is in whole minutes.');
        else input[field] = number;
      }
      for (const field of ['created_at','first_touch_at','two_way_at','next_step_at','promised_due_at'] as const) {
        if (!row[field]) continue;
        const date = importedDate(row[field]);
        if (!date) error(field,'Use an ISO timestamp with timezone, YYYY-MM-DD or DD/MM/YYYY.');
        else input[field === 'created_at' ? 'received_at' : field] = date;
      }
    }
    return { row:index + 2,input,errors };
  });
}

function csvCell(value: unknown): string {
  const raw = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  // Spreadsheet programs evaluate formula-prefixed text even inside CSV quotes.
  const safe = typeof value === 'string' && /^[\s]*[=+\-@\t\r]/.test(raw) ? "'" + raw : raw;
  return '"' + safe.replaceAll('"','""') + '"';
}
export function exportCsv(rows: Record<string, unknown>[], columns?: string[]): string {
  const keys = columns || [...new Set(rows.flatMap(row => Object.keys(row)))];
  return '\uFEFF' + [keys.map(csvCell).join(','),...rows.map(row => keys.map(key => csvCell(row[key])).join(','))].join('\r\n') + '\r\n';
}

/** Small, uncompressed ZIP writer for a collection of owner CSV exports. */
export function zipEntries(entries: { name:string; content:string }[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0, centralSize = 0;
  const crc32 = (bytes: Uint8Array) => { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; };
  for (const entry of entries) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(entry.name)) throw new CsvError('Invalid archive entry name.');
    const name = encoder.encode(entry.name), data = encoder.encode(entry.content), crc = crc32(data);
    const local = new Uint8Array(30 + name.length), view = new DataView(local.buffer);
    view.setUint32(0,0x04034b50,true);view.setUint16(4,20,true);view.setUint16(6,0x800,true);view.setUint32(14,crc,true);view.setUint32(18,data.length,true);view.setUint32(22,data.length,true);view.setUint16(26,name.length,true);local.set(name,30);
    const directory = new Uint8Array(46 + name.length), dir = new DataView(directory.buffer);
    dir.setUint32(0,0x02014b50,true);dir.setUint16(4,20,true);dir.setUint16(6,20,true);dir.setUint16(8,0x800,true);dir.setUint32(16,crc,true);dir.setUint32(20,data.length,true);dir.setUint32(24,data.length,true);dir.setUint16(28,name.length,true);dir.setUint32(42,offset,true);directory.set(name,46);
    chunks.push(local,data);central.push(directory);offset += local.length + data.length;centralSize += directory.length;
  }
  const end = new Uint8Array(22), tail = new DataView(end.buffer);
  tail.setUint32(0,0x06054b50,true);tail.setUint16(8,entries.length,true);tail.setUint16(10,entries.length,true);tail.setUint32(12,centralSize,true);tail.setUint32(16,offset,true);
  const output = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;for (const chunk of [...chunks,...central,end]) { output.set(chunk,cursor);cursor += chunk.length; }
  return output;
}
