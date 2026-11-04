import { findPhoneNumbersInText, parsePhoneNumberFromString } from 'libphonenumber-js';

export function normalizePhone(input: string | null | undefined): string | null {
  if (!input?.trim()) return null;
  const phone = parsePhoneNumberFromString(input.trim(), 'AU');
  return phone?.isValid() ? phone.number : null;
}

export function displayPhone(input: string | null | undefined): string {
  if (!input) return '';
  const phone = parsePhoneNumberFromString(input, 'AU');
  return phone?.isValid() ? (phone.country === 'AU' ? phone.formatNational() : phone.formatInternational()) : input;
}

export function normalizeEmail(input: string | null | undefined): string | null {
  const email = input?.trim().toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export interface ParsedLead {
  first_name: string;
  last_name: string;
  phone_e164: string | null;
  phone_display: string;
  email: string | null;
  business: string;
  suburb: string;
  notes: string;
}

// These locality hints improve a pasted Adelaide enquiry; every field is confirmed before saving.
const suburbs = ['Morphett Vale', 'Port Noarlunga', 'Noarlunga Centre', 'Mount Barker', 'Port Adelaide', 'North Adelaide', 'West Lakes', 'Glenelg', 'Brighton', 'Marion', 'Seaford', 'Aldinga', 'Reynella', 'Unley', 'Norwood', 'Prospect', 'Salisbury', 'Gawler', 'Adelaide'];

export function parseQuickLead(input: string): ParsedLead {
  const text = input.trim();
  const match = findPhoneNumbersInText(text, 'AU')[0];
  const emailMatch = text.match(/[^\s<>,;]+@[^\s<>,;]+\.[^\s<>,;]+/);
  const firstDetailAt = Math.min(match?.startsAt ?? text.length, emailMatch?.index ?? text.length);
  const name = (firstDetailAt < text.length ? text.slice(0, firstDetailAt) : '').trim().replace(/[,;:]$/, '').split(/\s+/);
  let remainder = text.slice(firstDetailAt);
  if (match) remainder = remainder.replace(text.slice(match.startsAt, match.endsAt), '');
  if (emailMatch) remainder = remainder.replace(emailMatch[0], '');
  remainder = remainder.replace(/^[\s,;:]+/, '').trim();
  const suburb = suburbs.find((place) => new RegExp(`\\b${place}\\b`, 'i').test(remainder)) ?? '';
  const suburbAt = suburb ? remainder.toLowerCase().indexOf(suburb.toLowerCase()) : -1;
  const notesAt = remainder.search(/\b(wants?|needs?|looking for|interested in|enquiry about)\b/i);
  const businessEnd = Math.min(suburbAt < 0 ? remainder.length : suburbAt, notesAt < 0 ? remainder.length : notesAt);
  return {
    first_name: name[0] ?? '', last_name: name.slice(1).join(' '),
    phone_e164: match?.number.number ?? null,
    phone_display: match?.number.formatNational() ?? '',
    email: normalizeEmail(emailMatch?.[0]),
    business: remainder.slice(0, businessEnd).trim().replace(/[,;:]$/, ''), suburb,
    notes: notesAt >= 0 ? remainder.slice(notesAt) : (firstDetailAt === text.length ? text : ''),
  };
}
