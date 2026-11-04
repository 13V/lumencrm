import { formatMoney } from './money';

export function median(values: number[]): number | null { return percentile(values, 0.5); }
/** Linear interpolation, with the denominator/sample size displayed separately by the caller. */
export function percentile(values: number[], quantile: number): number | null {
  if (quantile < 0 || quantile > 1) throw new Error('Quantile must be between zero and one');
  if (!values.length) return null;
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * quantile, lower = Math.floor(position), weight = position - lower;
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * weight;
}
export function conversionRate(numerator: number, denominator: number): { value: number | null; numerator: number; denominator: number; label: string } {
  if (numerator < 0 || denominator < 0 || numerator > denominator) throw new Error('Invalid counts');
  const value = denominator ? numerator / denominator : null;
  return { value, numerator, denominator, label: value === null ? 'none yet (0)' : `${Math.round(value * 100)}% (${numerator}/${denominator})` };
}
export function costPerResult(spend: number, count: number): { value: number | null; label: string; spend: number; count: number } {
  if (spend < 0 || !Number.isInteger(count) || count < 0) throw new Error('Invalid spend or count');
  return { value: count ? spend / count : null, label: count ? formatMoney(spend / count) : `none yet (${formatMoney(spend)} spent)`, spend, count };
}
export function presalesPerCustomer(deals: { presales_minutes: number; demo_build_minutes: number; outcome: string }[]): { total_minutes: number; won: number; minutes_per_customer: number | null } {
  const total_minutes = deals.reduce((sum, deal) => sum + deal.presales_minutes + deal.demo_build_minutes, 0);
  const won = deals.filter((deal) => deal.outcome === 'won').length;
  return { total_minutes, won, minutes_per_customer: won ? total_minutes / won : null };
}
export interface AcquisitionInputs { project_revenue: number; delivery_costs: number; retained_contribution: number; hourly_rate: number; presales_minutes_per_qualified_lead: number; close_rate_low: number; close_rate_high: number }
export function acquisitionRange(input: AcquisitionInputs) {
  if (Object.values(input).some((value) => !Number.isFinite(value) || value < 0) || input.close_rate_low <= 0 || input.close_rate_high > 1 || input.close_rate_low > input.close_rate_high) throw new Error('Enter non-negative amounts and a close-rate range between 0 and 100%');
  const scenario = (rate: number) => {
    const presales_cost_per_customer = input.presales_minutes_per_qualified_lead / 60 * input.hourly_rate / rate;
    const advertising_cac = input.project_revenue - input.delivery_costs - input.retained_contribution - presales_cost_per_customer;
    return { rate, presales_cost_per_customer, advertising_cac, cost_per_qualified_lead: advertising_cac * rate };
  };
  return { low: scenario(input.close_rate_low), high: scenario(input.close_rate_high) };
}
