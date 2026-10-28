'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
export function SaveCommunityTrip({ postId, days, signedIn, author }: { postId: string; days: number; signedIn: boolean; author: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!signedIn) return <Link className="button-primary" href={`/?next=${encodeURIComponent(`/community/${postId}`)}`}>Sign in to save to My trips</Link>;
  return <section className="community-save">
    <button className="button-primary" type="button" onClick={() => setOpen(value => !value)} disabled={busy}>Save to My trips ↗</button>
    {open && <form className="settings-card mt-4" onSubmit={async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      setBusy(true); setError('');
      try {
        const response = await fetch(`/api/community/${postId}/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ start_date: form.get('start_date') }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Could not save this trip.');
        router.push(`/trips/${result.tripId}`); router.refresh();
      } catch (failure) { setError(failure instanceof Error ? failure.message : 'Save failed. Please try again.'); setBusy(false); }
    }}>
      <h2 className="text-xl font-semibold">Make this trip your own</h2>
      <p className="mt-2 text-sm text-slate-600">Save an independent {days}-day copy shared by {author}. You can edit it and ask AI to revise or regenerate it. The original stays unchanged.</p>
      <label className="mt-4 block">Your start date<input className="community-input mt-2 block" type="date" name="start_date" required max="9999-12-01" disabled={busy} /></label>
      <p className="mt-3 text-sm text-slate-500">The card starts as “Shared by {author}” and becomes “Owned” after you save a changed itinerary. Repeated saves open your existing copy.</p>
      {error && <p className="error-text mt-3" role="alert">{error}</p>}
      <div className="mt-4 flex gap-3"><button className="button-primary" disabled={busy}>{busy ? 'Saving your copy…' : 'Save and open trip'}</button><button type="button" className="button-secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</button></div>
    </form>}
  </section>;
}
