import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKING_HOURS, workingMinutesBetween, nextStepAt, parsePromiseDate, adelaideDate, addWorkingDays } from '@/lib/domain';
describe('Adelaide working time', () => {
  it('counts five minutes during daylight saving', () => expect(workingMinutesBetween('2026-11-04T00:00:00Z', '2026-11-04T00:05:00Z')).toBe(5));
  it('does not count overnight, weekends or the configured public holiday', () => {
    const config = { ...DEFAULT_WORKING_HOURS, holidays: ['2026-11-09'] };
    expect(workingMinutesBetween('2026-11-06T06:00:00Z', '2026-11-09T23:00:00Z', config)).toBe(60);
  });
  it('handles the daylight saving boundary without using the machine timezone', () => {
    expect(workingMinutesBetween('2026-10-02T07:00:00Z', '2026-10-04T23:00:00Z')).toBe(60);
  });
  it('keeps before-hours arrivals at zero until the business opens', () => expect(workingMinutesBetween('2026-11-03T20:00:00Z', '2026-11-03T22:20:00Z')).toBe(0));
  it('returns zero for reversed intervals', () => expect(workingMinutesBetween('2026-11-04T01:00:00Z', '2026-11-04T00:00:00Z')).toBe(0));
  it('sets tomorrow to 9am Adelaide, and skips non-working days', () => {
    expect(nextStepAt('tomorrow', '2026-11-04T05:00:00Z')).toBe('2026-11-04T22:30:00.000Z');
    expect(nextStepAt('tomorrow', '2026-11-06T05:00:00Z')).toBe('2026-11-08T22:30:00.000Z');
  });
  it('adds follow-up days over a holiday', () => expect(addWorkingDays('2026-11-06T05:00:00Z', 2, { ...DEFAULT_WORKING_HOURS, holidays: ['2026-11-09'] })).toBe('2026-11-10T22:30:00.000Z'));
  it('does not spin forever for a schedule with no call days', () => expect(() => nextStepAt('tomorrow', new Date(), { ...DEFAULT_WORKING_HOURS, days: [] })).toThrow('Invalid working hours'));
});
describe('promised dates', () => {
  it('keeps an explicitly past promise overdue instead of moving it to next year', () => expect(parsePromiseDate('by Wednesday 21 October', '2026-11-04T05:07:47Z')).toBe('2026-10-21T04:30:00.000Z'));
  it('parses a relative day at 3pm Adelaide', () => expect(parsePromiseDate('by tomorrow', '2026-11-04T05:07:47Z')).toBe('2026-11-05T04:30:00.000Z'));
  it('rejects vague or impossible dates', () => { expect(parsePromiseDate('when ready')).toBeNull(); expect(parsePromiseDate('by 31 February')).toBeNull(); expect(parsePromiseDate('2026-99-99')).toBeNull(); });
  it('formats Australian date labels', () => expect(adelaideDate('2026-11-10T23:30:00Z')).toBe('Wed 11 Nov'));
});
