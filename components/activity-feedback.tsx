'use client';

import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { CurrentVote, FeedbackSummary, VoteValue } from '@/lib/feedback';

export function ActivityFeedback({ tripId, itemId, title, initialSummary, readOnly = false, children }: {
  tripId: string; itemId: string; title: string; initialSummary: FeedbackSummary | null; readOnly?: boolean; children?: ReactNode;
}) {
  const router = useRouter();
  const submitting = useRef(false);
  const [summary, setSummary] = useState(initialSummary);
  const [mine, setMine] = useState<CurrentVote | null>(initialSummary?.mine ?? null);
  const [value, setValue] = useState<VoteValue | null>(initialSummary?.mine?.value ?? null);
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
        // Retain legacy comments when changing a vote; new text belongs to suggestions.
        body: JSON.stringify({ item_id: itemId, value, comment: mine?.comment ?? null }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Feedback could not be saved. Please try again.');
      // Update immediately after the confirmed INSERT; refresh reconciles other cards.
      setSummary(result.summary);
      const current: CurrentVote = result.summary?.mine ?? result.saved;
      setMine(current);
      setValue(current.value);
      setMessage(result.warning || '✓ Saved');
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save feedback. Please try again.');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  const dirty = value !== (mine?.value ?? null);
  const comments = summary?.group.filter(vote => vote.comment?.trim()).length ?? 0;
  function select(next: VoteValue) {
    setValue(next);
    setMessage('');
    setError('');
  }

  return (
    <div className="feedback-workspace compact-feedback mt-4">
      <div className="group-feedback-heading">
        <p className="eyebrow">GROUP FEEDBACK</p>
        <div className="feedback-counts flex flex-wrap gap-3 text-sm" aria-live="polite">
          {summary ? <><span className="font-semibold text-teal-800">{summary.likes} {summary.likes === 1 ? 'Like' : 'Likes'}</span><span className="font-semibold text-slate-600">{summary.dislikes} {summary.dislikes === 1 ? 'Dislike' : 'Dislikes'}</span></>
            : <span className="text-amber-800">Counts unavailable. Refresh to try again.</span>}
        </div>
      </div>
      {summary && <>
        <p className="mt-2 text-sm text-slate-600">{summary.group.length
          ? `${summary.group.length} ${summary.group.length === 1 ? 'traveler has' : 'travelers have'} responded · ${comments} ${comments === 1 ? 'comment' : 'comments'}`
          : 'No feedback yet. Be the first to share your take.'}</p>
        {summary.group.length > 0 && <details className="feedback-details mt-2">
          <summary>View traveler feedback</summary>
          <ul className="mt-2 divide-y divide-slate-200" aria-label="Traveler feedback">
            {summary.group.map(vote => <li key={vote.userId} className="py-3 text-sm">
              <p><strong>{vote.name || `Traveler ${vote.userId.slice(0, 8)}`}</strong> · {vote.value === 1 ? 'Like' : 'Dislike'}</p>
              {vote.comment && <p className="mt-1 whitespace-pre-wrap break-words text-slate-600">{vote.comment}</p>}
            </li>)}
          </ul>
        </details>}
      </>}
      <div className="your-take">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="eyebrow">YOUR FEEDBACK</p>
          <p className={`feedback-save-state text-xs ${dirty && !readOnly ? 'text-amber-800' : 'text-teal-800'}`} role="status">
            {busy ? 'Saving…' : dirty && !readOnly ? 'Unsaved changes — submit to save' : mine ? `Saved: ${mine.value === 1 ? 'Like' : 'Dislike'}` : summary ? 'Not submitted yet' : 'Saved feedback unavailable'}
          </p>
        </div>
        {readOnly ? <p className="mt-2 text-xs text-slate-500">Earlier version · Read-only</p> : <form onSubmit={submit} className="mt-3" aria-label={`Feedback for ${title}`} aria-busy={busy}>
          <fieldset disabled={busy}>
            <legend className="sr-only">Choose Like or Dislike, then submit to save</legend>
            <div className="feedback-actions flex flex-wrap items-center gap-2">
              <button type="button" aria-pressed={value === 1} className={value === 1 ? 'button-primary' : 'button-secondary'} onClick={() => select(1)}>Like</button>
              <button type="button" aria-pressed={value === -1} className={value === -1 ? 'button-primary' : 'button-secondary'} onClick={() => select(-1)}>Dislike</button>
              <button type="submit" className="button-secondary feedback-submit" disabled={value === null}>{busy ? 'Saving…' : 'Submit feedback'}</button>
            </div>
          </fieldset>
          <div className="mt-2 text-sm" aria-live="polite">
            {message && <p className="motion-success text-teal-800" role="status">{message}</p>}
            {error && <p className="text-red-700" role="alert">{error}</p>}
          </div>
        </form>}
        {children}
      </div>
    </div>
  );
}
