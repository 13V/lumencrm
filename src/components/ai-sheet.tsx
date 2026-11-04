'use client';
import { useEffect, useState } from 'react';
import { Button, Field, Sheet } from './ui';
import type { CrmMode } from '@/lib/types';
import { useOnline } from './use-online';
export function AiSheet({ open, onClose, dealId, mode }: { open: boolean; onClose: () => void; dealId?: string; mode: CrmMode }) {
  const online = useOnline();
  const [available, setAvailable] = useState(false), [busy, setBusy] = useState(false), [draft, setDraft] = useState(''), [text, setText] = useState(''), [error, setError] = useState('');
  useEffect(() => { if (open && mode === 'live') void fetch('/api/ai').then(r => r.json()).then(d => setAvailable(d.enabled && d.configured)); }, [open, mode]);
  async function generate(action: string) {
    if (!online) { setError('Reconnect to prepare a draft.'); return; }
    setBusy(true); setError('');
    try { const response = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, deal_id: dealId, text }) }); const value = await response.json(); if (!response.ok) throw new Error(value.error); setDraft(typeof value.draft === 'string' ? value.draft : JSON.stringify(value.draft, null, 2)); } catch (e) { setError(e instanceof Error ? e.message : 'No draft is available.'); } finally { setBusy(false); }
  }
  return <Sheet open={open} onOpenChange={value => !value && onClose()} title="A draft, ready for your judgement" description="Selected lead notes or pasted details are sent to Anthropic. Nothing is sent to a client or saved without your action."><div className="form-stack">{!available ? <p className="muted">{mode === 'demo' ? 'AI is not connected in the fictional preview.' : 'Enable the AI helper in Settings and configure its provider key to use drafts.'}</p> : <>{dealId ? <div className="row"><Button variant="outline" disabled={busy || !online} onClick={() => void generate('summary')}>Summarise this lead</Button><Button variant="outline" disabled={busy || !online} onClick={() => void generate('reply')}>Draft a reply</Button></div> : <><Field label="Pasted contact details"><textarea value={text} onChange={e => setText(e.target.value)} /></Field><Button disabled={busy || !online || !text.trim()} onClick={() => void generate('parse')}>Parse into a draft</Button></>}{busy && <p role="status">Preparing a draft…</p>}</>}{error && <p role="alert" className="error-text">{error}</p>}{draft && <><Field label="Review and edit the draft"><textarea rows={10} value={draft} onChange={e => setDraft(e.target.value)} /></Field><p className="muted">Check facts, prices, monthly fees and any promised dates before using this.</p><Button onClick={async () => { await navigator.clipboard.writeText(draft); setError('Draft copied.'); }}>Copy reviewed draft</Button></>}</div></Sheet>;
}
