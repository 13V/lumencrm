export interface QuoteLine { qty: number; unit_price: number | string; kind: 'once' | 'monthly'; included?: boolean }
export function cents(input: number | string): number {
  const value = typeof input === 'number' ? input.toFixed(2) : input.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error('Enter a non-negative amount with no more than two decimal places');
  const [whole, decimal = ''] = value.split('.');
  const result = Number(whole) * 100 + Number(decimal.padEnd(2, '0'));
  if (!Number.isSafeInteger(result) || result > 999999999999) throw new Error('Amount exceeds the supported limit');
  return result;
}
export function quoteTotals(items: QuoteLine[]): { total_once: number; total_monthly: number } {
  const totals = { total_once: 0, total_monthly: 0 };
  for (const item of items) {
    if (!Number.isFinite(item.qty) || item.qty <= 0) throw new Error('Quantity must be greater than zero');
    const value = item.included ? 0 : Math.round(cents(item.unit_price) * item.qty);
    totals[item.kind === 'monthly' ? 'total_monthly' : 'total_once'] += value;
  }
  return { total_once: totals.total_once / 100, total_monthly: totals.total_monthly / 100 };
}
export function formatInvoiceNumber(prefix: string, sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error('Invoice sequence must be a positive integer');
  if (!/^[A-Za-z0-9-]{1,20}$/.test(prefix)) throw new Error('Invalid invoice prefix');
  return `${prefix}${prefix.endsWith('-') ? '' : '-'}${String(sequence).padStart(4, '0')}`;
}
export function formatMoney(amount: number, decimals = false): string { return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', minimumFractionDigits: decimals ? 2 : 0, maximumFractionDigits: 2 }).format(amount); }
export function invoiceBalance(total: number, payments: { amount: number }[]): number { return (cents(total) - payments.reduce((sum, payment) => sum + cents(payment.amount), 0)) / 100; }
