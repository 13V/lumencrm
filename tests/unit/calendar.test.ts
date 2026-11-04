import { describe, it, expect } from 'vitest';
import { calendarIcs } from '@/lib/domain/calendar';
describe('private ICS', () => {
  it('uses UTC instants, stable UIDs and escapes content injection', () => {
    const result = calendarIcs([{ id: 'one', starts_at: '2026-11-05T00:30:00Z', ends_at: '2026-11-05T00:45:00Z', kind: 'call', status: 'cancelled', name: 'Name\nEND:VEVENT', notes: 'a,b;c\\d' }]);
    expect(result).toContain('DTSTART:20261105T003000Z'); expect(result).toContain('UID:one@lumen-crm'); expect(result).toContain('Name\\nEND:VEVENT'); expect(result).toContain('STATUS:CANCELLED'); expect(result).toContain('a\\,b\\;c\\\\d');
  });
  it('folds multi-byte long notes within 75 octets', () => {
    const result = calendarIcs([{ id: 'one', starts_at: '2026-11-05T00:30:00Z', ends_at: '2026-11-05T00:45:00Z', kind: 'call', status: 'booked', notes: '✓'.repeat(90) }]);
    expect(result.split('\r\n').every(line => new TextEncoder().encode(line).length <= 75)).toBe(true);
  });
});
