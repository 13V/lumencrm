export interface PublicQuote {
  number: string; status: string; issued_at: string; expires_at: string; accepted_at: string | null;
  business_name: string; total_once: number; total_monthly: number; terms_url: string; notes: string | null;
  items: { description: string; qty: number; unit_price: number; kind: 'once' | 'monthly'; included: boolean; included_details: string[] }[];
  lumen: { trading_name: string; phone: string; email: string }; deposit_percentage: number | null;
  gst: { registered: boolean; wording: string };
}
