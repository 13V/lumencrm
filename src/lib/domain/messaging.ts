const gsmBasic = new Set([..."@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà"]);
const gsmExtended = new Set([...'^{}\\[~]|€\f']);
export function smsSegments(text: string): { encoding: 'GSM-7' | 'Unicode'; units: number; segments: number; warning: boolean } {
  const characters = [...text];
  const gsm = characters.every((character) => gsmBasic.has(character) || gsmExtended.has(character));
  const units = gsm ? characters.reduce((sum, character) => sum + (gsmExtended.has(character) ? 2 : 1), 0) : text.length;
  const segments = units === 0 ? 0 : gsm ? (units <= 160 ? 1 : Math.ceil(units / 153)) : (units <= 70 ? 1 : Math.ceil(units / 67));
  return { encoding: gsm ? 'GSM-7' : 'Unicode', units, segments, warning: segments > 3 };
}
export function isStopMessage(text: string): boolean { return /^(stop|stopall|unsubscribe|cancel|end|quit)\s*[.!]?$/i.test(text.trim()); }
export function canMessage(contact: { do_not_contact?: boolean; sms_opt_out_at?: string | null; email_opt_out_at?: string | null }, channel: 'sms' | 'email'): boolean {
  return !contact.do_not_contact && !(channel === 'sms' ? contact.sms_opt_out_at : contact.email_opt_out_at);
}
export function fillTemplate(template: string, variables: Record<string, string>): string { return template.replace(/\{([a-z_]+)\}/g, (match, key: string) => variables[key] ?? match); }
export const TEMPLATE_VARIABLES = ['first_name', 'business', 'demo_link', 'quote_link', 'call_time', 'invoice_number', 'amount', 'due_date', 'promise'] as const;
export function templateVariableErrors(text: string): string[] {
  const allowed = new Set<string>(TEMPLATE_VARIABLES), errors = new Set<string>();
  const remaining = text.replace(/\{([^{}]*)\}/g, (_match, key: string) => { if (!allowed.has(key)) errors.add(`Unknown variable: {${key}}`); return ''; });
  if (/[{}]/.test(remaining)) errors.add('Variables need one pair of braces, for example {first_name}.');
  return [...errors];
}
export function escapeHtml(text: string): string { return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c); }
