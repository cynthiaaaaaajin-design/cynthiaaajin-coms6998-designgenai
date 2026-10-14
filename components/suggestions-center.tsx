'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { requestTypes, type ChangeRequest, type Person } from '@/lib/collaboration';
export function SuggestionsCenter({ tripId, requests, people, items, isOwner, isCurrent, versionNumber, error }: {
  tripId: string; requests: ChangeRequest[]; people: Person[]; items: { id: string; title: string; day_number: number }[];
  isOwner: boolean; isCurrent: boolean; versionNumber: number; error: boolean;
}) {
  const router = useRouter();
  const lock = useRef(false);
  const [busy, setBusy] = useState('');
  const [failure, setFailure] = useState('');
  async function review(id: string, status: 'resolved' | 'declined') {
    if (lock.current) return;
    lock.current = true; setBusy(id); setFailure('');
    try {
      const response = await fetch(`/api/trips/${tripId}/suggestions`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Suggestion could not be updated.');
      router.refresh();
    } catch (e) { setFailure(e instanceof Error ? e.message : 'Unable to connect. Try again.'); }
    finally { lock.current = false; setBusy(''); }
  }
  const days = [...new Set(requests.map(row => items.find(i => i.id === row.item_id)?.day_number ?? 0))].sort((a,b) => a-b);
  function rows(status: 'pending' | 'reviewed') {
    return days.map(day => {
      const group = requests.filter(row => (items.find(i => i.id === row.item_id)?.day_number ?? 0) === day && (status === 'pending' ? row.status === 'pending' : row.status !== 'pending'));
      return group.length > 0 && <div key={day} className="mt-4"><h3 className="text-sm font-semibold">{day ? `Day ${day}` : 'Activity unavailable'}</h3><ul className="divide-y divide-slate-200">{group.map(row => <li key={row.id} className="py-3 text-sm break-words">
        <p><strong>{items.find(i => i.id === row.item_id)?.title || 'Activity unavailable'}</strong> · {people.find(p => p.user_id === row.created_by)?.name || `Traveler ${row.created_by.slice(0,8)}`}</p>
        <p className="mt-1">{requestTypes[row.request_type]} · <span className="font-semibold">{row.status}</span></p>
        {row.reason && <p className="mt-1 whitespace-pre-wrap">{row.reason}</p>}
        {row.comment && <p className="mt-1 whitespace-pre-wrap">{row.comment}</p>}
        {row.suggested_replacement && <p className="mt-1 whitespace-pre-wrap">Replacement: {row.suggested_replacement}</p>}
        {isOwner && row.status === 'pending' && <div className="mt-2 flex flex-wrap gap-2"><button className="button-secondary" disabled={!!busy} onClick={() => review(row.id, 'resolved')}>{busy === row.id ? 'Saving…' : 'Mark resolved'}</button><button className="button-secondary" disabled={!!busy} onClick={() => review(row.id, 'declined')}>Decline suggestion</button></div>}
      </li>)}</ul></div>;
    });
  }
  return <section className="settings-card mt-6" aria-labelledby="suggestions-heading">
    <h2 id="suggestions-heading" className="text-xl font-semibold">Suggestions to review</h2>
    <p className="mt-2 text-sm text-slate-500">{isCurrent ? 'Current itinerary' : 'Historical itinerary'} · Version {versionNumber}{!isOwner && ' · Your submitted suggestions'}</p>
    {error ? <p className="notice mt-3" role="alert">Suggestions could not be loaded. Refresh or check the collaboration migration.</p> : <>
      <p className="mt-3 text-sm">{requests.filter(r => r.status === 'pending').length} pending · {requests.filter(r => r.status === 'resolved').length} resolved · {requests.filter(r => r.status === 'declined').length} declined</p>
      {rows('pending')}
      {!requests.some(r => r.status === 'pending') && <p className="mt-3 text-sm text-slate-500">No pending suggestions for this version.</p>}
      {requests.some(r => r.status !== 'pending') && <details className="feedback-details mt-3"><summary>Reviewed suggestions</summary>{rows('reviewed')}</details>}
    </>}
    {failure && <p role="alert" className="mt-3 text-sm text-red-700">{failure}</p>}
  </section>;
}
