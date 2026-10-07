'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { CurrentVote, FeedbackSummary, VoteValue } from '@/lib/feedback';

export function ActivityFeedback({ tripId, itemId, title, initialSummary, readOnly = false }: {
  tripId: string; itemId: string; title: string; initialSummary: FeedbackSummary | null; readOnly?: boolean;
}) {
  const router = useRouter();
  const submitting = useRef(false);
  const [summary, setSummary] = useState(initialSummary);
  const [mine, setMine] = useState<CurrentVote | null>(initialSummary?.mine ?? null);
  const [value, setValue] = useState<VoteValue | null>(initialSummary?.mine?.value ?? null);
  const [comment, setComment] = useState(initialSummary?.mine?.comment ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    if (value === null) { setError('Choose Like or Dislike before submitting.'); return; }
    submitting.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}/votes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: itemId, value, comment }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Feedback could not be saved. Please try again.');
      // Update immediately after the confirmed INSERT; refresh reconciles other cards.
      setSummary(result.summary);
      const current: CurrentVote = result.summary?.mine ?? result.saved;
      setMine(current);
      setValue(current.value);
      setComment(current.comment ?? '');
      setMessage(result.warning || '✓ Saved');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save feedback. Please try again.');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="mt-5 border-t border-slate-100 pt-5">
      <div key={`${summary?.likes}:${summary?.dislikes}`} className="feedback-counts flex flex-wrap gap-4 text-sm" aria-live="polite">
        {summary ? <><span className="font-semibold text-teal-800">{summary.likes} Likes</span><span className="font-semibold text-slate-600">{summary.dislikes} Dislikes</span></>
          : <span className="text-amber-800">Feedback counts are unavailable. Refresh to try again.</span>}
      </div>
      {summary && <section className="mt-4" aria-label="Group feedback">
        <h5 className="font-semibold">Group feedback</h5>
        {summary.group.length ? <ul className="mt-2 divide-y divide-slate-100">
          {summary.group.map(vote => <li key={vote.userId} className="py-3 text-sm">
            <p className="font-semibold">{vote.name || `Traveler ${vote.userId.slice(0, 8)}`}</p>
            <p className="mt-1">{vote.value === 1 ? '👍 Like' : '👎 Dislike'}</p>
            {vote.comment && <p className="mt-2 whitespace-pre-wrap break-words text-slate-600">{vote.comment}</p>}
          </li>)}
        </ul> : <p className="mt-2 text-sm text-slate-500">No feedback yet.</p>}
      </section>}
      <p className="mt-2 text-sm text-slate-500">Your latest feedback: {mine ? mine.value === 1 ? 'Like' : 'Dislike' : summary ? 'Not submitted yet' : 'Unavailable'}</p>
      {mine?.comment && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">Your latest comment: {mine.comment}</p>}
      {!readOnly && <form onSubmit={submit} className="mt-4" aria-label={`Feedback for ${title}`} aria-busy={busy}>
        <fieldset disabled={busy}>
          <legend className="sr-only">Choose Like or Dislike</legend>
          <div className="flex flex-wrap gap-2">
            <button type="button" aria-pressed={value === 1} className={value === 1 ? 'button-primary' : 'button-secondary'} onClick={() => setValue(1)}>Like</button>
            <button type="button" aria-pressed={value === -1} className={value === -1 ? 'button-primary' : 'button-secondary'} onClick={() => setValue(-1)}>Dislike</button>
          </div>
          <div className="mt-4">
            <label htmlFor={`feedback-${itemId}`}>Comment (optional)</label>
            <textarea id={`feedback-${itemId}`} rows={2} maxLength={2000} value={comment} onChange={event => setComment(event.target.value)} placeholder="What works for you? What would you change?" />
          </div>
          <button type="submit" className="button-primary mt-3" disabled={value === null}>{busy ? 'Saving feedback…' : 'Submit feedback'}</button>
        </fieldset>
        <div className="mt-3 text-sm" aria-live="polite">
          {message && <p className="motion-success text-teal-800" role="status">{message}</p>}
          {error && <p className="text-red-700" role="alert">{error}</p>}
        </div>
      </form>}
    </div>
  );
}
