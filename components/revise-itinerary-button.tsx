'use client';

import { useRef, useState } from 'react';
import { PlanningStatus } from '@/components/planning-status';
import { useRouter } from 'next/navigation';

export function ReviseItineraryButton({ tripId }: { tripId: string }) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  async function revise() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}/revise`, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Your itinerary could not be revised. Please try again.');
      setSaved(true);
      router.push(`/trips/${encodeURIComponent(tripId)}?version=${encodeURIComponent(result.versionId)}`, { scroll: false });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to connect. Please try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="mt-5" aria-busy={busy}>
      <button type="button" className="button-primary" disabled={busy || saved} onClick={revise}>
        {busy ? 'Reshaping your itinerary…' : saved ? 'Revision saved' : 'Revise with group feedback'}
      </button>
      <div aria-live="polite" className="mt-3 text-sm">
        {busy && <PlanningStatus revision />}
        {saved && <p role="status" className="motion-success text-teal-800">✓ Your revised itinerary is saved. Loading the new version…</p>}
        {error && <p role="alert" className="text-red-700">{error}</p>}
      </div>
    </div>
  );
}
