import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

export const ADELAIDE = 'Australia/Adelaide';
export interface WorkingHours { days: number[]; start: string; end: string; holidays: string[]; timeZone: string }
export const DEFAULT_WORKING_HOURS: WorkingHours = { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', holidays: [], timeZone: ADELAIDE };
export type DateInput = string | Date | number;

function validDate(input: DateInput): Date { const date = new Date(input); if (!Number.isFinite(date.getTime())) throw new Error('Invalid date'); return date; }
function dayKey(input: DateInput, zone: string): string { return formatInTimeZone(validDate(input), zone, 'yyyy-MM-dd'); }
function shiftDay(day: string, count: number): string { const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + count); return date.toISOString().slice(0, 10); }
function validateHours(hours: WorkingHours): void {
  if (!hours.days.length || hours.days.some((day) => !Number.isInteger(day) || day < 0 || day > 6) || !/^\d{2}:\d{2}$/.test(hours.start) || !/^\d{2}:\d{2}$/.test(hours.end) || hours.start >= hours.end) throw new Error('Invalid working hours');
  for (const time of [hours.start, hours.end]) { const [h, m] = time.split(':').map(Number); if (h > 23 || m > 59) throw new Error('Invalid working hours'); }
}
export function isWorkingDay(day: string, config: WorkingHours = DEFAULT_WORKING_HOURS): boolean {
  return config.days.includes(new Date(`${day}T12:00:00Z`).getUTCDay()) && !config.holidays.includes(day);
}

export function workingMinutesBetween(start: DateInput, end: DateInput, config: WorkingHours = DEFAULT_WORKING_HOURS): number {
  validateHours(config);
  const from = validDate(start).getTime(), to = validDate(end).getTime();
  if (to <= from) return 0;
  let day = dayKey(from, config.timeZone), last = dayKey(to, config.timeZone), millis = 0;
  while (day <= last) {
    if (isWorkingDay(day, config)) {
      const opens = fromZonedTime(`${day}T${config.start}:00`, config.timeZone).getTime();
      const closes = fromZonedTime(`${day}T${config.end}:00`, config.timeZone).getTime();
      millis += Math.max(0, Math.min(to, closes) - Math.max(from, opens));
    }
    day = shiftDay(day, 1);
  }
  return millis / 60_000;
}

export function addWorkingDays(input: DateInput, count: number, config: WorkingHours = DEFAULT_WORKING_HOURS, time = config.start): string {
  validateHours(config);
  if (!Number.isInteger(count) || count < 0) throw new Error('Working day count must be a non-negative integer');
  let day = dayKey(input, config.timeZone), remaining = count, guard = 0;
  while (remaining > 0 || !isWorkingDay(day, config)) {
    day = shiftDay(day, 1);
    if (isWorkingDay(day, config)) remaining = Math.max(0, remaining - 1);
    if (++guard > 3660) throw new Error('No working day available');
  }
  return fromZonedTime(`${day}T${time}:00`, config.timeZone).toISOString();
}

export function nextStepAt(preset: 'later_today' | 'tomorrow' | 'two_days' | 'next_week', now: DateInput = new Date(), config: WorkingHours = DEFAULT_WORKING_HOURS): string {
  validateHours(config);
  if (preset !== 'later_today') return addWorkingDays(now, preset === 'tomorrow' ? 1 : preset === 'two_days' ? 2 : 5, config, '09:00');
  const day = dayKey(now, config.timeZone);
  const candidate = Math.max(validDate(now).getTime() + 2 * 60 * 60_000, fromZonedTime(`${day}T${config.start}:00`, config.timeZone).getTime());
  const close = fromZonedTime(`${day}T${config.end}:00`, config.timeZone).getTime();
  return isWorkingDay(day, config) && candidate < close ? new Date(candidate).toISOString() : addWorkingDays(now, 1, config);
}

export function adelaideDate(input: DateInput, pattern = 'EEE d MMM'): string { return formatInTimeZone(validDate(input), ADELAIDE, pattern); }
export function adelaideTime(input: DateInput): string { return formatInTimeZone(validDate(input), ADELAIDE, 'h:mma').toLowerCase(); }

/** Explicit dates retain the year of receipt unless a year was written. A past promise stays overdue. */
export function parsePromiseDate(text: string, receivedAt: DateInput = new Date()): string | null {
  const lower = text.toLowerCase().trim(), receivedDay = dayKey(receivedAt, ADELAIDE);
  let day: string | null = null;
  const iso = lower.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  const named = lower.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:\s+(\d{4}))?\b/);
  if (iso) day = iso[1];
  else if (named) {
    const month = months.findIndex((m) => m === named[2] || m.slice(0, 3) === named[2]);
    if (month >= 0) day = `${named[3] ?? receivedDay.slice(0, 4)}-${String(month + 1).padStart(2, '0')}-${named[1].padStart(2, '0')}`;
  } else if (/\btomorrow\b/.test(lower)) day = shiftDay(receivedDay, 1);
  else if (/\btoday\b/.test(lower)) day = receivedDay;
  else {
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const weekday = weekdays.findIndex((name) => new RegExp(`\\b${name}\\b`).test(lower));
    if (weekday >= 0) day = shiftDay(receivedDay, (weekday - new Date(`${receivedDay}T12:00:00Z`).getUTCDay() + 7) % 7);
  }
  if (!day) return null;
  const calendarDate = new Date(`${day}T12:00:00Z`);
  if (!Number.isFinite(calendarDate.getTime()) || calendarDate.toISOString().slice(0, 10) !== day) return null;
  const parsed = fromZonedTime(`${day}T15:00:00`, ADELAIDE);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}
