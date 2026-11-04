export type Role = 'owner' | 'staff' | 'viewer';
export type CrmMode = 'demo' | 'live';
export type StageKey = string;
export type Outcome = 'open' | 'won' | 'lost' | 'unsuitable' | 'noreply';
export interface Contact {
  id: string; business_id: string | null; first_name: string; last_name: string | null;
  phone_e164: string | null; phone_display: string | null; email: string | null;
  preferred_channel?: string | null; best_time?: string | null;
  sms_opt_out_at: string | null; email_opt_out_at: string | null; do_not_contact: boolean;
  created_at?: string; updated_at?: string; deleted_at?: string | null;
}
export interface Business {
  id: string; name: string; trade: string | null; suburb: string | null;
  website_url?: string | null; service_areas?: string[] | null;
  created_at?: string; updated_at?: string; deleted_at?: string | null;
}
export interface Deal {
  id: string; contact_id: string; business_id: string | null; title: string;
  owner_id: string | null; channel: string; stage_key: StageKey; outcome: Outcome;
  value_once: number | null; value_monthly: number | null;
  promised_text: string | null; promised_due_at: string | null;
  next_step: string | null; next_step_at: string | null;
  first_touch_at: string | null; two_way_at: string | null;
  presales_minutes?: number; demo_build_minutes?: number;
  chloe_status?: string | null; chloe_fields?: Record<string, unknown>; returning?: boolean;
  created_at: string; updated_at?: string; deleted_at?: string | null;
}
export interface Task {
  id: string; deal_id: string | null; title: string; due_at: string | null;
  done_at: string | null; priority: string; created_at?: string; updated_at?: string;
}
export interface Appointment {
  id: string; deal_id: string | null; contact_id: string | null; starts_at: string; ends_at: string;
  kind: string; status: string; source?: string | null; notes: string | null;
  created_at?: string; updated_at?: string;
}
export interface Activity {
  id: string; deal_id: string | null; contact_id: string | null; type: string;
  body: string | null; occurred_at: string; meta: Record<string, unknown>;
  created_at?: string;
}
export interface Profile { id: string; full_name?: string | null; name?: string; email?: string; role: Role }
export interface Attribution { id?: string; deal_id: string; source?: string | null; utm_source?: string | null; utm_medium?: string | null; utm_campaign?: string | null; utm_term?: string | null; utm_content?: string | null; raw?: Record<string, unknown> }
export interface CrmData {
  contacts: Contact[]; businesses: Business[]; deals: Deal[]; tasks: Task[];
  appointments: Appointment[]; activities: Activity[]; profiles: Profile[]; attribution: Attribution[];
  user?: { id: string; name: string; email?: string };
  config?: { call_hours?: { days: number[]; start: string; end: string; holidays?: string[]; timeZone?: string }; speed_to_lead_minutes?: number; sales_stages?: { key: string; label: string }[]; delivery_stages?: {key:string;label:string}[]; source_labels?: string[]; integrations?: {chloe_enabled?:boolean;sms_enabled?:boolean;email_enabled?:boolean} };
}
export const STAGES: { key: StageKey; label: string }[] = [
  { key: 'new', label: 'New' }, { key: 'contacted', label: 'Contacted' },
  { key: 'suitable', label: 'Suitable' }, { key: 'call_booked', label: 'Call booked' },
  { key: 'brief', label: 'Brief agreed' }, { key: 'demo', label: 'Demo sent' },
  { key: 'quote', label: 'Quote sent' }, { key: 'won', label: 'Won' },
];
export const OUTCOMES: { key: Outcome; label: string }[] = [
  { key: 'open', label: 'Open' }, { key: 'won', label: 'Won' }, { key: 'lost', label: 'Lost' },
  { key: 'unsuitable', label: 'Unsuitable' }, { key: 'noreply', label: 'No reply' },
];
export const EMPTY_CRM_DATA: CrmData = { contacts: [], businesses: [], deals: [], tasks: [], appointments: [], activities: [], profiles: [], attribution: [] };
