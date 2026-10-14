'use client';

import { useState, type FormEvent } from 'react';
import { PlanningStatus } from '@/components/planning-status';
import { useRouter } from 'next/navigation';

export function GenerateItineraryForm({ tripId, submitted = 0, total = 0, preferencesError = false }: { tripId: string; submitted?: number; total?: number; preferencesError?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(fields)),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Your itinerary could not be saved. Please try again.');
      setSaved(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to connect. Please refresh and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 border-t border-slate-200 pt-5" aria-label="Generate itinerary with AI">
      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
        AI will use your group’s saved preferences to create a day-by-day plan.
      </p>
      {!preferencesError && submitted < total && <p className="notice mt-4">{submitted} of {total} travelers have shared their preferences. You can generate now or wait for everyone.</p>}
      {preferencesError && <p className="notice mt-4" role="alert">Group preferences could not be loaded. Refresh before generating.</p>}
      <form className="mt-6" onSubmit={submit} aria-busy={busy}>
        <fieldset disabled={busy || saved || preferencesError} className="grid gap-5 md:grid-cols-2">
          <legend className="sr-only">Generate from saved group preferences</legend>
          <details className="feedback-details md:col-span-2">
            <summary>Extra trip instructions (optional)</summary>
            <div className="mt-4 grid gap-4">
                <div className="md:col-span-2">
                  <label htmlFor="budget">Trip-level budget (optional)</label>
                  <input id="budget" name="budget" maxLength={300} placeholder="For example, USD 150 per person per day, excluding flights" />
                  <p className="mt-2 text-xs text-slate-500">Include currency and whether this is per day, per person, or for the whole trip.</p>
                </div>
                <div className="md:col-span-2">
                  <label htmlFor="instructions">Instructions for the whole group</label>
                  <textarea id="instructions" name="instructions" maxLength={2000} rows={3} placeholder="Arrival time, departure time, or other trip logistics…" />
                </div>
            </div>
          </details>
          <div className="md:col-span-2">
            <button className="button-primary" type="submit">
              {busy ? 'Planning your trip…' : saved ? 'Itinerary saved' : submitted < total ? 'Generate anyway' : 'Generate itinerary with AI'}
            </button>
          </div>
        </fieldset>
        <div aria-live="polite" className="mt-4 text-sm">
          {busy && <PlanningStatus />}
          {saved && <p className="motion-success text-teal-800" role="status">✓ Your itinerary is saved. Loading your plan…</p>}
          {error && <p role="alert" className="text-red-700">{error}</p>}
        </div>
      </form>
    </div>
  );
}
