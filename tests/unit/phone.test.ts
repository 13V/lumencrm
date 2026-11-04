import { describe, expect, it } from 'vitest';
import { normalizePhone, normalizeEmail, parseQuickLead } from '@/lib/domain';
describe('contact matching inputs', () => {
  it.each(['0491 570 156', '+61 491 570 156', '(0491) 570-156', '0491570156'])('normalises %s to one E.164 identity', (input) => expect(normalizePhone(input)).toBe('+61491570156'));
  it('rejects invalid phones and accepts absent contact methods', () => { expect(normalizePhone('123')).toBeNull(); expect(normalizePhone('')).toBeNull(); expect(normalizePhone(null)).toBeNull(); });
  it('matches email without case or outer whitespace', () => expect(normalizeEmail('  Dave@EXAMPLE.com ')).toBe('dave@example.com'));
  it('extracts the example without an AI request', () => expect(parseQuickLead('Dave 0491 570 156 Sparky Co Morphett Vale wants a new site')).toMatchObject({ first_name: 'Dave', phone_e164: '+61491570156', business: 'Sparky Co', suburb: 'Morphett Vale', notes: 'wants a new site' }));
  it('does not invent a name for a pasted number or email', () => { expect(parseQuickLead('0491 570 156').first_name).toBe(''); expect(parseQuickLead('dave@example.com').first_name).toBe(''); });
});
