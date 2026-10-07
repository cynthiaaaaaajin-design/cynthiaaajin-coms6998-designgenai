'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export function RepairItineraryButton({ tripId, versionId }: { tripId: string; versionId: string }) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  async function repair() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}/repair`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ versionId }),
      });
      if (!response.ok) throw new Error('Repair failed');
      setSaved(true);
      router.refresh();
    } catch {
      setError("We couldn't restore this itinerary. Please try again.");
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="mt-4" aria-busy={busy}>
    <button type="button" className="button-primary" disabled={busy || saved} onClick={repair}>{busy ? 'Restoring your itinerary…' : saved ? 'Itinerary restored' : 'Repair itinerary'}</button>
    <div aria-live="polite" className="mt-3 text-sm">
      {busy && <p role="status">Restoring your saved plan. This may take a moment.</p>}
      {saved && <p role="status">✓ Itinerary restored. Loading your activities…</p>}
      {error && <p role="alert" className="text-red-700">{error}</p>}
    </div>
  </div>;
}
