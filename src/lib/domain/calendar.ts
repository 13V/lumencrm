export interface CalendarEvent { id: string; ics_uid?: string | null; starts_at: string; ends_at: string; status: string; kind: string; updated_at?: string; name?: string; business?: string; notes?: string | null }
const escapeText = (value: string) => value.replaceAll('\\', '\\\\').replaceAll('\r', '').replaceAll('\n', '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;');
const stamp = (date: string) => new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function fold(line: string) {
  const chunks: string[] = []; let part = ''; let bytes = 0;
  for (const char of line) { const size = new TextEncoder().encode(char).length; if (bytes + size > 74) { chunks.push(part); part = ' '; bytes = 1; } part += char; bytes += size; }
  return [...chunks, part].join('\r\n');
}
export function calendarIcs(events: CalendarEvent[], now = new Date()) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lumen adl//CRM//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:Lumen calls', 'X-WR-TIMEZONE:Australia/Adelaide'];
  for (const event of events) lines.push('BEGIN:VEVENT', `UID:${escapeText(event.ics_uid || `${event.id}@lumen-crm`)}`, `DTSTAMP:${stamp(now.toISOString())}`, `DTSTART:${stamp(event.starts_at)}`, `DTEND:${stamp(event.ends_at)}`, `LAST-MODIFIED:${stamp(event.updated_at || now.toISOString())}`, `SUMMARY:${escapeText([event.kind.replaceAll('_', ' '), event.name, event.business].filter(Boolean).join(' · '))}`, `DESCRIPTION:${escapeText(event.notes || '')}`, `STATUS:${event.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT');
  lines.push('END:VCALENDAR'); return lines.map(fold).join('\r\n') + '\r\n';
}
