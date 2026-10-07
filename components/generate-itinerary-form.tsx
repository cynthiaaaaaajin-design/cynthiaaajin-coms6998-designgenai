'use client';

import { useState, type FormEvent } from 'react';
import { PlanningStatus } from '@/components/planning-status';
import { useRouter } from 'next/navigation';

export function GenerateItineraryForm({ tripId }: { tripId: string }) {
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
    <section className="settings-card mt-8" aria-labelledby="generate-heading">
      <p className="eyebrow">A LITTLE INSPIRATION</p>
      <h2 id="generate-heading" className="mt-3 text-2xl font-semibold">Generate itinerary with AI</h2>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500">
        Tell us what makes a great trip for you. We’ll turn your preferences into a day-by-day plan.
      </p>
      <form className="mt-6" onSubmit={submit} aria-busy={busy}>
        <fieldset disabled={busy || saved} className="grid gap-5 md:grid-cols-2">
          <legend className="sr-only">Your itinerary preferences</legend>
          <div className="md:col-span-2">
            <label htmlFor="budget">Budget *</label>
            <input id="budget" name="budget" required maxLength={300} placeholder="For example, USD 150 per person per day, excluding flights" />
            <p className="mt-2 text-xs text-slate-500">Include currency and whether this is per day, per person, or for the whole trip.</p>
          </div>
          <div>
            <label htmlFor="interests">Interests / preferences *</label>
            <textarea id="interests" name="interests" required maxLength={2000} rows={4} placeholder="Local food, museums, quiet walks, a relaxed pace…" />
          </div>
          <div>
            <label htmlFor="avoid">Things to avoid</label>
            <textarea id="avoid" name="avoid" maxLength={2000} rows={4} placeholder="Crowded attractions, long hikes, early mornings…" />
          </div>
          <div className="md:col-span-2">
            <label htmlFor="instructions">Optional instructions</label>
            <textarea id="instructions" name="instructions" maxLength={2000} rows={3} placeholder="Arrival time, accessibility needs, must-see places…" />
          </div>
          <div className="md:col-span-2">
            <button className="button-primary" type="submit">
              {busy ? 'Planning your trip…' : saved ? 'Itinerary saved' : 'Generate itinerary with AI'}
            </button>
          </div>
        </fieldset>
        <div aria-live="polite" className="mt-4 text-sm">
          {busy && <PlanningStatus />}
          {saved && <p className="motion-success text-teal-800" role="status">✓ Your itinerary is saved. Loading your plan…</p>}
          {error && <p role="alert" className="text-red-700">{error}</p>}
        </div>
      </form>
    </section>
  );
}
