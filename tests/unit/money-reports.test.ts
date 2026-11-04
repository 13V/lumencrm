import { describe, expect, it } from 'vitest';
import { quoteTotals, cents, formatInvoiceNumber, costPerResult, conversionRate, median, percentile, presalesPerCustomer, acquisitionRange } from '@/lib/domain';
describe('quote and invoice maths', () => {
  it('keeps one-off, monthly and included lines separate', () => expect(quoteTotals([{ qty: 1, unit_price: 2200, kind: 'once' }, { qty: 1, unit_price: 49, kind: 'monthly' }, { qty: 1, unit_price: 300, kind: 'once', included: true }])).toEqual({ total_once: 2200, total_monthly: 49 }));
  it('uses cents for money arithmetic', () => { expect(quoteTotals([{ qty: 3, unit_price: '0.10', kind: 'once' }]).total_once).toBe(0.3); expect(cents('100.01')).toBe(10001); });
  it('rejects negative money and zero quantities', () => { expect(() => cents(-1)).toThrow(); expect(() => quoteTotals([{ qty: 0, unit_price: 1, kind: 'once' }])).toThrow(); });
  it('formats a reserved database sequence without wrapping at 9999', () => { expect(formatInvoiceNumber('LUM', 1)).toBe('LUM-0001'); expect(formatInvoiceNumber('LUM-', 10000)).toBe('LUM-10000'); });
});
describe('honest reports', () => {
  it('reports $300 and three enquiries without inventing customers', () => { expect(costPerResult(300, 3).value).toBe(100); expect(costPerResult(300, 0).label).toBe('none yet ($300 spent)'); });
  it('includes denominators and no fabricated zero denominator rates', () => { expect(conversionRate(1, 4).label).toBe('25% (1/4)'); expect(conversionRate(0, 0).value).toBeNull(); });
  it('uses sample quantiles and handles no observations', () => { expect(median([5, 1, 2, 9])).toBe(3.5); expect(percentile([0, 10], 0.9)).toBe(9); expect(median([])).toBeNull(); });
  it('includes time lost on unsuccessful deals', () => expect(presalesPerCustomer([{ presales_minutes: 30, demo_build_minutes: 90, outcome: 'won' }, { presales_minutes: 60, demo_build_minutes: 120, outcome: 'lost' }])).toEqual({ total_minutes: 300, won: 1, minutes_per_customer: 300 }));
  it('computes advertising allowance at each close-rate boundary separately', () => {
    const result = acquisitionRange({ project_revenue: 2200, delivery_costs: 200, retained_contribution: 1000, hourly_rate: 100, presales_minutes_per_qualified_lead: 60, close_rate_low: 0.2, close_rate_high: 0.5 });
    expect(result.low.advertising_cac).toBe(500); expect(result.low.cost_per_qualified_lead).toBe(100); expect(result.high.advertising_cac).toBe(800); expect(result.high.cost_per_qualified_lead).toBe(400);
  });
});
