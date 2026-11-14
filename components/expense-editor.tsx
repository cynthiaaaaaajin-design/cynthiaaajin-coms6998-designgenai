'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { currencies, type Expense } from '@/lib/expenses';
import { expenseCategories, type ReceiptDraft } from '@/lib/expense-receipt';

type Person = { user_id: string; name: string | null };
type Fields = { description: string; amount: string; currency: string; payer: string; date: string; category: string; note: string };

export function ExpenseEditor({ tripId, userId, people, expense, busy, onSave, onCancel }: {
  tripId: string; userId: string; people: Person[]; expense?: Expense; busy: boolean;
  onSave: (body: object) => Promise<boolean>; onCancel: () => void;
}) {
  const [fields, setFields] = useState<Fields>(() => ({
    description: expense?.description ?? '',
    amount: expense ? (expense.amount / 10 ** currencies[expense.currency]).toFixed(currencies[expense.currency]) : '',
    currency: expense?.currency ?? 'USD', payer: expense?.payer_id ?? userId,
    date: expense?.expense_date ?? new Date().toLocaleDateString('en-CA'), category: expense?.category ?? 'Food & Drinks', note: expense?.note ?? '',
  }));
  const [selected, setSelected] = useState(expense?.allocations.map(a => a.user_id) ?? [userId]);
  const [method, setMethod] = useState<'equal' | 'custom' | 'percentage'>(expense ? 'custom' : 'equal');
  const [shares, setShares] = useState<Record<string, string>>(() => Object.fromEntries(expense?.allocations.map(a => [a.user_id, (a.amount / 10 ** currencies[expense.currency]).toFixed(currencies[expense.currency])]) ?? []));
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState<ReceiptDraft | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const request = useRef<AbortController | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const previewUrl = useRef('');
  const generation = useRef(0);
  const submitLock = useRef(false);
  const expenseId = useRef(expense?.id ?? crypto.randomUUID());
  const name = (id: string) => people.find(p => p.user_id === id)?.name || `Traveler ${id.slice(0, 6)}`;

  useEffect(() => {
    const currentRequest = request;
    const currentGeneration = generation;
    const currentPreview = previewUrl;
    return () => { currentGeneration.current++; currentRequest.current?.abort(); if (currentPreview.current) URL.revokeObjectURL(currentPreview.current); };
  }, []);

  function update(key: keyof Fields, value: string) { setFields(f => ({ ...f, [key]: value })); setReviewed(false); }
  function chooseFile(next: File | null) {
    generation.current++; request.current?.abort(); setReading(false); setError(''); setReviewed(false);
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = ''; setPreview('');
    if (next && (!['image/jpeg', 'image/png', 'image/webp'].includes(next.type) || next.size > 2 * 1024 * 1024 || !next.size)) {
      if (fileInput.current) fileInput.current.value = '';
      setFile(null); setError('Choose a JPEG, PNG or WebP image up to 2 MB.'); return;
    }
    setFile(next);
    if (!next && fileInput.current) fileInput.current.value = '';
    if (next) { previewUrl.current = URL.createObjectURL(next); setPreview(previewUrl.current); }
  }
  async function readReceipt() {
    if (!file || reading || busy) return;
    const current = ++generation.current;
    const controller = new AbortController(); request.current = controller;
    setReading(true); setError(''); setReviewed(false);
    try {
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader(); reader.onerror = () => reject(Error('This image could not be opened.'));
        reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.readAsDataURL(file);
      });
      if (generation.current !== current) return;
      const response = await fetch(`/api/trips/${tripId}/expenses/receipt`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        signal: controller.signal, body: JSON.stringify({ mimeType: file.type, data }),
      });
      const result = await response.json();
      if (generation.current !== current) return;
      if (!response.ok) throw Error(result.error || 'Receipt recognition failed.');
      const draft: ReceiptDraft = result.draft;
      setReceipt(draft);
      setFields(f => ({ ...f, description: draft.description, amount: draft.amount ?? '', currency: draft.currency ?? '', date: draft.expense_date ?? '', category: draft.category }));
    } catch (e) {
      if (generation.current === current && !controller.signal.aborted) setError(e instanceof Error ? e.message : 'Receipt recognition failed. Enter the expense manually.');
    } finally { if (generation.current === current) setReading(false); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current || busy || reading || receipt && !reviewed) return;
    submitLock.current = true;
    try {
      await onSave({ id: expenseId.current, description: fields.description, amount: fields.amount, currency: fields.currency,
        payer_id: fields.payer, expense_date: fields.date, category: fields.category, note: fields.note, split_method: method,
        participants: selected.map(user_id => ({ user_id, value: shares[user_id] || undefined })),
      });
    } finally { submitLock.current = false; }
  }

  return <div className="expense-editor mt-4">
    <section className="receipt-upload" aria-labelledby="receipt-upload-title">
      <p className="eyebrow">LESS TYPING, MORE TRAVEL</p>
      <h3 id="receipt-upload-title">Start with a receipt</h3>
      <p>Upload a receipt or payment screenshot for AI to read, or fill in the form yourself.</p>
      <p className="receipt-privacy">The image is sent to our AI provider for recognition. TripSync does not store it. Only the details you confirm are shared with your trip.</p>
      <label>Receipt image · JPEG, PNG or WebP · up to 2 MB
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e => chooseFile(e.target.files?.[0] ?? null)} />
      </label>
      {preview && <div className="receipt-preview"><a href={preview} target="_blank" rel="noopener noreferrer">
        {/* Local, temporary upload preview; no public storage URL is created. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview} alt="Receipt selected for recognition" />
      </a><span>{file?.name}</span></div>}
      <div className="flex flex-wrap gap-3"><button type="button" className="button-primary" disabled={!file || reading || busy} onClick={() => void readReceipt()}>{reading ? 'Reading receipt…' : 'Read receipt with AI'}</button>
        {(file || receipt) && <button type="button" className="button-secondary" disabled={busy} onClick={() => { chooseFile(null); setReceipt(null); setReviewed(false); }}>Continue manually</button>}
      </div>
      {reading && <p role="status">Extracting the total, currency and date. Nothing has been saved.</p>}
      {error && <p role="alert" className="notice">{error} You can always enter the details below.</p>}
    </section>
    <form className="travel-form mt-4" onSubmit={submit}>
      <h3 className="text-xl font-semibold">{receipt ? 'Review your receipt details' : expense ? 'Edit expense' : 'Expense details'}</h3>
      {receipt && <aside className="receipt-review" role="status"><strong>AI draft · not saved yet</strong><p>Is everything correct? Edit any field, then confirm the payer and everyone sharing this expense.</p>
        {receipt.warnings.length > 0 && <ul>{receipt.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul>}
      </aside>}
      <fieldset disabled={busy || reading} className="expense-fields">
        <label>Description<input required maxLength={200} value={fields.description} onChange={e => update('description', e.target.value)} /></label>
        <div className="travel-form-row"><label>Amount<input required inputMode="decimal" placeholder="0.00" value={fields.amount} onChange={e => update('amount', e.target.value)} /></label>
          <label>Currency<select required value={fields.currency} onChange={e => update('currency', e.target.value)}><option value="">Choose currency</option>{Object.keys(currencies).map(c => <option key={c}>{c}</option>)}</select></label></div>
        <div className="travel-form-row"><label>Paid by<select value={fields.payer} onChange={e => update('payer', e.target.value)}>{people.map(p => <option key={p.user_id} value={p.user_id}>{name(p.user_id)}{p.user_id === userId ? ' (you)' : ''}</option>)}</select></label>
          <label>Date<input required type="date" value={fields.date} onChange={e => update('date', e.target.value)} /></label></div>
        <div className="travel-form-row"><label>Category<select value={fields.category} onChange={e => update('category', e.target.value)}>{expenseCategories.map(c => <option key={c}>{c}</option>)}</select></label>
          <label>Split method<select value={method} onChange={e => { setMethod(e.target.value as typeof method); setReviewed(false); }}><option value="equal">Equal</option><option value="custom">Custom amounts</option><option value="percentage">Percentages</option></select></label></div>
        <fieldset><legend>Who shared this expense?</legend><p className="text-sm text-slate-500">Only selected travelers share the cost. Check this even if you uploaded the receipt.</p>
          <button type="button" className="expense-select-all" onClick={() => { setSelected(people.map(p => p.user_id)); setReviewed(false); }}>Select all travelers</button>
          {people.map(p => <div key={p.user_id} className="expense-participant"><label><input type="checkbox" checked={selected.includes(p.user_id)} onChange={e => { setSelected(ids => e.target.checked ? [...ids, p.user_id] : ids.filter(id => id !== p.user_id)); setReviewed(false); }} />{name(p.user_id)}</label>
            {selected.includes(p.user_id) && method !== 'equal' && <label><span className="sr-only">{name(p.user_id)} {method === 'percentage' ? 'percentage' : 'amount'}</span><input required inputMode="decimal" placeholder={method === 'percentage' ? '%' : 'Amount'} value={shares[p.user_id] ?? ''} onChange={e => { setShares(s => ({ ...s, [p.user_id]: e.target.value })); setReviewed(false); }} /></label>}</div>)}
          <p className="text-xs text-slate-500">Custom shares must equal the total; percentages must total 100%. Any remaining cent is allocated consistently.</p>
        </fieldset>
        <label>Note<textarea maxLength={2000} value={fields.note} onChange={e => update('note', e.target.value)} /></label>
        {receipt && <label className="receipt-confirm"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I checked the amount, currency, date, payer and selected travelers. These details are correct.</label>}
        <div className="flex flex-wrap gap-3"><button disabled={!selected.length || !!receipt && !reviewed} className="button-primary">{busy ? 'Saving expense…' : 'Confirm & save expense'}</button>
          <button type="button" className="button-secondary" onClick={onCancel}>Cancel</button></div>
      </fieldset>
    </form>
  </div>;
}
