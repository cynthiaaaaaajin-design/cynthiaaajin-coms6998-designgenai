'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export function TripActions({ tripId }: { tripId: string }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const locked = useRef(false);
  function share() {
    const crew = document.getElementById('travel-crew');
    if (crew instanceof HTMLDetailsElement) crew.open = true;
    crew?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('create-trip-invitation')?.focus({ preventScroll: true });
  }
  async function copy() {
    try { await navigator.clipboard.writeText(`${window.location.origin}/trips/${tripId}`); setMessage('Link copied. Only travelers you have added can open it.'); }
    catch { setMessage(`Share this private link with added travelers: ${window.location.origin}/trips/${tripId}`); }
  }
  async function remove() {
    if (locked.current) return;
    locked.current = true; setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/trips/${tripId}`, { method: 'DELETE' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Unable to delete this trip.');
      router.replace('/trips'); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to delete this trip.'); }
    finally { locked.current = false; setBusy(false); }
  }
  return <div className="trip-actions">
    <div className="flex flex-wrap gap-3"><button className="button-primary" onClick={share}>Share trip</button><button className="button-secondary" onClick={copy}>Copy member-only link</button><button className="button-secondary trip-delete" onClick={() => setConfirm(!confirm)} disabled={busy} aria-expanded={confirm}>Delete trip</button></div>
    {confirm && <div className="delete-confirm" role="group" aria-label="Confirm trip deletion"><p className="font-semibold">Permanently delete this trip?</p><p className="mt-2 text-sm">This cannot be undone. You and your travelers will lose access to this saved trip.</p><div className="mt-3 flex flex-wrap gap-3"><button className="button-primary" disabled={busy} onClick={remove}>{busy ? 'Deleting…' : 'Yes, delete trip'}</button><button className="button-secondary" disabled={busy} onClick={() => setConfirm(false)}>Keep trip</button></div></div>}
    <p className="mt-3 text-sm break-words" role="status">{message}</p>
  </div>;
}
