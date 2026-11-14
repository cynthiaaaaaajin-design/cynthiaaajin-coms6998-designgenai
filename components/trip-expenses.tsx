'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { currencies, money, type Currency, type Expense, type Transfer } from '@/lib/expenses';
import { ExpenseEditor } from '@/components/expense-editor';

type Person = { user_id: string; name: string | null };
type Snapshot = { id: string; created_at: string; transfers: Transfer[] };
type Data = {
  expenses: Expense[]; snapshots: Snapshot[];
  receipts: { settlement_id: string; transfer_index: number }[];
  fingerprint: string; people: Person[];
  preview: { ledgers: Partial<Record<Currency, Record<string, number>>>; transfers: Transfer[] };
};

export function TripExpenses({ tripId, userId, isOwner }: { tripId: string; userId: string; isOwner: boolean }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [editorKey, setEditorKey] = useState(0);
  const [showBalances, setShowBalances] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const sequence = useRef(0);
  const writing = useRef(false);
  const fingerprint = useRef<string | null>(null);

  const load = useCallback(async (force = false) => {
    if (writing.current && !force) return;
    const ticket = ++sequence.current;
    try {
      const response = await fetch(`/api/trips/${tripId}/expenses`, { cache: 'no-store' });
      const body = await response.json();
      if (ticket !== sequence.current) return;
      if (!response.ok) throw Error(body.error || 'Expenses could not be refreshed.');
      if (fingerprint.current !== body.fingerprint) setConfirm(false);
      fingerprint.current = body.fingerprint;
      setData(body); setError('');
    } catch (e) { if (ticket === sequence.current) { setConfirm(false); setError(e instanceof Error ? e.message : 'Expenses could not be refreshed.'); } }
  }, [tripId]);

  useEffect(() => {
    let active = true;
    const requests = sequence;
    void Promise.resolve().then(() => { if (active) void load(); });
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    const timer = window.setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { active = false; requests.current++; window.clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [load]);

  async function write(body: object) {
    if (writing.current) return false;
    writing.current = true; sequence.current++;
    setBusy(true); setError(''); setNotice(''); setConfirm(false);
    try {
      const response = await fetch(`/api/trips/${tripId}/expenses`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'The expense could not be saved.');
      await load(true);
      setNotice('Saved. Settlement suggestions reflect confirmed expenses only.');
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : 'The expense could not be saved.'); return false; }
    finally { writing.current = false; setBusy(false); }
  }
  function closeEditor() { setEditing(null); setEditorKey(n => n + 1); }
  const name = (id: string) => data?.people.find(p => p.user_id === id)?.name || `Traveler ${id.slice(0, 6)}`;
  const open = data?.expenses.filter(e => !e.settlement_id) ?? [];

  return <section aria-labelledby="expenses-heading" className="travel-section">
    <div className="section-heading"><p className="eyebrow">GOOD TIMES, SHARED FAIRLY</p><h2 id="expenses-heading" className="text-2xl font-semibold mt-2">Trip expenses</h2>
      <p className="text-slate-500 mt-2">Each traveler can scan a receipt or add an expense. Confirm the details, then see who owes whom.</p></div>
    {error && <p className="notice" role="alert">{error} <button disabled={busy} onClick={() => void load()}>Refresh expenses</button></p>}
    {notice && <p className="mt-4 text-sm text-teal-800" role="status">{notice}</p>}
    {!data && !error && <p role="status">Loading expenses…</p>}
    {data && <>
      <div className="expense-overview">{(Object.keys(currencies) as Currency[]).filter(c => data.expenses.some(e => e.currency === c)).map(c => <div key={c}><p className="eyebrow">{c} · RECORDED SPENDING</p><strong>{money(data.expenses.filter(e => e.currency === c).reduce((n, e) => n + e.amount, 0), c)}</strong><p>My open balance: {money(data.preview.ledgers[c]?.[userId] ?? 0, c)}</p></div>)}
        {!data.expenses.length && <p>No expenses yet. Start with a meal, a ride, or a shared stay.</p>}</div>
      <details open={!!editing} key={`${editing || 'new'}:${editorKey}`}>
        <summary className="button-secondary">{editing ? 'Edit expense' : '+ Add an expense'}</summary>
        <ExpenseEditor key={`${editing || 'new'}:${editorKey}`} tripId={tripId} userId={userId} people={data.people} expense={data.expenses.find(e => e.id === editing)} busy={busy} onCancel={closeEditor} onSave={async body => { const saved = await write(body); if (saved) closeEditor(); return saved; }} />
      </details>
      <section className="settlement-panel" aria-labelledby="settlement-title">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="eyebrow">EVERYONE’S CONFIRMED EXPENSES</p><h3 id="settlement-title" className="text-xl font-semibold mt-2">Who owes whom</h3></div><button type="button" className="button-secondary" disabled={busy} onClick={() => void load()}>Refresh balances</button></div>
        <p className="mt-3">Calculated automatically from saved expenses across your trip. Each currency stays separate. No money is moved.</p>
        <p className="text-xs text-slate-500 mt-2">Updates after saving, when you return to this window, and every 15 seconds while visible. Unconfirmed receipt drafts are excluded.</p>
        <div className="settlement-transfers" aria-live="polite">
          {!open.length ? <p>No unsettled expenses yet. Add and confirm an expense to get started.</p> : !data.preview.transfers.length ? <p>Everyone is balanced for the current expenses.</p>
            : data.preview.transfers.map(t => <p key={`${t.currency}:${t.from}:${t.to}`}><span>{name(t.from)} <span aria-hidden="true">→</span><span className="sr-only"> pays </span> {name(t.to)}</span><strong>{money(t.amount, t.currency)}</strong></p>)}
        </div>
        {open.length > 0 && <>
          <button className="button-secondary mt-3" onClick={() => setShowBalances(v => !v)} aria-expanded={showBalances}>{showBalances ? 'Hide balances' : 'Review settlement balances'}</button>
          {showBalances && <div>{Object.entries(data.preview.ledgers).map(([c, ledger]) => <div key={c}><h4 className="font-semibold mt-4">{c} balances</h4>{Object.entries(ledger!).map(([id, n]) => <p key={id}>{name(id)}: {money(Math.abs(n), c as Currency)} {n > 0 ? 'to receive' : n < 0 ? 'owed' : 'balanced'}</p>)}</div>)}</div>}
          {isOwner && <div className="mt-4"><p className="text-sm">Finalizing locks this settlement cycle. Later expenses start a new one.</p><label className="receipt-confirm mt-3"><input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} disabled={busy || !!error} />I reviewed these balances and transfers.</label><button disabled={busy || !confirm || !!error} className="button-primary mt-3" onClick={() => void write({ action: 'finalize', fingerprint: data.fingerprint })}>Finalize this settlement</button></div>}
        </>}
      </section>
      <div className="expense-list">{data.expenses.map(e => <article className="travel-record" key={e.id}><div><p className="text-xs text-slate-500">{e.expense_date} · {e.category}{e.settlement_id ? ' · Finalized' : ''}</p><h3>{e.description}</h3><p>{name(e.payer_id)} paid · Added by {name(e.created_by)} · {e.allocations.length} {e.allocations.length === 1 ? 'participant' : 'participants'}</p>
        <details><summary>Participant shares</summary>{e.allocations.map(a => <p key={a.user_id}>{name(a.user_id)}: {money(a.amount, e.currency)}</p>)}</details></div><div><strong>{money(e.amount, e.currency)}</strong>{!e.settlement_id && (isOwner || e.created_by === userId) && <div className="flex gap-2 mt-2"><button disabled={busy} onClick={() => { setEditing(e.id); setEditorKey(n => n + 1); }}>Edit</button><button disabled={busy} onClick={() => { closeEditor(); void write({ action: 'delete', id: e.id }); }}>Delete</button></div>}</div></article>)}</div>
      {data.snapshots.map(s => <details className="travel-record" key={s.id}><summary>Finalized {new Date(s.created_at).toLocaleString()} · {s.transfers.length} transfers</summary>{s.transfers.map((t, i) => <div className="mt-3" key={i}><p>{name(t.from)} → {name(t.to)} · {money(t.amount, t.currency)}</p>{data.receipts.some(r => r.settlement_id === s.id && r.transfer_index === i) ? <p>Receipt confirmed by recipient</p> : <><p>Payment not confirmed</p>{t.to === userId && <button disabled={busy} className="button-secondary" onClick={() => void write({ action: 'paid', settlement_id: s.id, index: i })}>Confirm I received payment</button>}</>}</div>)}</details>)}
    </>}
  </section>;
}
