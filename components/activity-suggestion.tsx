'use client';
import { useState, useRef, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { requestTypes } from '@/lib/collaboration';
export function ActivitySuggestion({ tripId, itemId, versionId, title }: { tripId: string; itemId: string; versionId: string; title: string }) {
  const router = useRouter();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState('general');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    lock.current = true; setBusy(true); setError(''); setSaved(false);
    try {
      const response = await fetch(`/api/trips/${tripId}/suggestions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...data, item_id: itemId, version_id: versionId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Suggestion could not be saved.');
      form.reset(); setCategory('general'); setSaved(true); router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to connect. Try again.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <details className="feedback-details activity-suggestion mt-3"><summary>Suggest a change</summary>
    <form onSubmit={submit} className="mt-3" aria-label={`Suggest a change to ${title}`}>
      <fieldset disabled={busy} className="grid gap-3"><legend className="sr-only">Suggestion details</legend>
        <label>Feedback category<select name="request_type" value={category} onChange={e => { setCategory(e.target.value); setSaved(false); }}>{Object.entries(requestTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {category === 'replacement' && <label>Replacement suggestion<textarea name="suggested_replacement" rows={2} maxLength={2000} required /></label>}
        <label>Explanation (optional)<textarea name="comment" rows={2} maxLength={2000} /></label>
        <div><button className="button-secondary" type="submit">{busy ? 'Saving…' : 'Submit suggestion'}</button></div>
      </fieldset>
      {saved && <p role="status" className="mt-2 text-sm text-teal-800">Suggestion saved. Track its status in Suggestions to review.</p>}
      {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    </form>
  </details>;
}
