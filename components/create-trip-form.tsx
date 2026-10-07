'use client';
import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { parseNewTrip } from '@/lib/create-trip';

export function CreateTripForm() {
  const router = useRouter();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [start, setStart] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    setError('');
    const fields = new FormData(event.currentTarget);
    try {
      const trip = parseNewTrip(Object.fromEntries(fields));
      inFlight.current = true;
      setBusy(true);
      const response = await fetch('/api/trips', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(trip),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Your trip could not be created.');
      router.push(`/trips/${encodeURIComponent(result.tripId)}`);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to connect. Please try again.');
      inFlight.current = false;
      setBusy(false);
    }
  }
  return <form className="settings-card create-trip-form mt-8" onSubmit={submit} aria-busy={busy}>
    <fieldset disabled={busy} className="grid gap-5 sm:grid-cols-2">
      <legend className="sr-only">New trip details</legend>
      <div className="sm:col-span-2"><label htmlFor="trip-title">Trip name *</label><input id="trip-title" name="title" required maxLength={200} placeholder="A weekend to remember" /></div>
      <div className="sm:col-span-2"><label htmlFor="destination">Destination *</label><input id="destination" name="destination" required maxLength={300} placeholder="Lisbon, Portugal" /></div>
      <div><label htmlFor="start-date">Start date *</label><input id="start-date" name="start_date" type="date" required value={start} onChange={event => setStart(event.target.value)} /></div>
      <div><label htmlFor="end-date">End date *</label><input id="end-date" name="end_date" type="date" required min={start || undefined} /></div>
      <p className="sm:col-span-2 text-sm text-slate-500">Your trip starts private. Next, add your budget and preferences to generate an itinerary. AI planning currently supports trips up to 30 days.</p>
      <div className="sm:col-span-2 flex flex-wrap items-center gap-4"><button className="button-primary" type="submit">{busy ? 'Creating your trip…' : 'Create trip'}</button><Link className="text-sm font-semibold text-teal-800" href="/trips">Cancel</Link></div>
    </fieldset>
    <div aria-live="polite" className="mt-4 text-sm">{error && <p role="alert" className="text-red-700">{error}</p>}{busy && <p role="status" className="text-teal-800">Saving your private trip and opening your plan…</p>}</div>
  </form>;
}
