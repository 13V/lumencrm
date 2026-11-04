export const SALES_STAGES = [
  { key: 'new', label: 'New' }, { key: 'contacted', label: 'Contacted' },
  { key: 'suitable', label: 'Suitable' }, { key: 'call_booked', label: 'Call booked' },
  { key: 'brief', label: 'Brief agreed' }, { key: 'demo', label: 'Demo sent' },
  { key: 'quote', label: 'Quote sent' }, { key: 'won', label: 'Won' },
] as const;
export type StageKey = typeof SALES_STAGES[number]['key'];
export type DealOutcome = 'open' | 'won' | 'lost' | 'unsuitable' | 'noreply';
export interface StageEvidence { two_way_at?: string | null; sent_quote?: boolean; accepted_quote?: boolean; override_reason?: string | null }
export function assertStageTransition(target: string, evidence: StageEvidence, stages: readonly { key: string }[] = SALES_STAGES): void {
  if (!stages.some((stage) => stage.key === target)) throw new Error('Choose a valid stage');
  if (target === 'contacted' && !evidence.two_way_at) throw new Error('Contacted needs a reply or a connected call');
  if (target === 'quote' && !evidence.sent_quote) throw new Error('Send a quote before moving to Quote sent');
  if (target === 'won' && !evidence.accepted_quote && !evidence.override_reason?.trim()) throw new Error('Won needs an accepted quote or an override reason');
}
export function recordFirstMilestone(existing: Record<string, string>, stage: string, at: string): Record<string, string> {
  return existing[stage] ? existing : { ...existing, [stage]: at };
}
export function closeDeal<T extends { stage_key: string }>(deal: T, outcome: Exclude<DealOutcome, 'open'>, at: string) {
  return { ...deal, outcome, closed_at: at };
}
