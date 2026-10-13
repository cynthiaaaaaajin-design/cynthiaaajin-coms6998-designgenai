'use client';
import { TripInvitation } from '@/components/trip-invitation';
import { TravelerInitials } from '@/components/traveler-initials';

import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { Traveler } from '@/lib/travelers';

export function ManageTravelers({ tripId, ownerId, initialTravelers, loadError }: {
  tripId: string; ownerId: string; initialTravelers: Traveler[]; loadError: boolean;
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [travelers, setTravelers] = useState(initialTravelers);
  const [listError, setListError] = useState(loadError);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function mutate(method: 'POST' | 'DELETE', payload: object, action: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(action);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/trips/${encodeURIComponent(tripId)}/members`, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Traveler access could not be updated.');
      if (method === 'POST') {
        setEmail('');
        setMessage(`${result.message} They can find this trip in their Trip collection with a Shared label.`);
        // RPC returns a status only. Reload membership rows under existing RLS.
        try {
          const listResponse = await fetch(`/api/trips/${encodeURIComponent(tripId)}/members`, { cache: 'no-store' });
          const list = await listResponse.json();
          if (!listResponse.ok) throw new Error('List unavailable');
          setTravelers(list.travelers);
          setListError(false);
        } catch {
          setListError(true);
        }
      } else {
        setTravelers(current => current.filter(member => member.userId !== result.removedUserId));
        setMessage('Traveler removed. Their feedback history is preserved. Revoke the invitation link too if they should not rejoin.');
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update travelers. Please try again.');
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void mutate('POST', { email }, 'add');
  }

  return (
    <details id="travel-crew" className="settings-card crew-section crew-disclosure mt-8">
      <summary className="font-semibold"><span className="crew-heading"><span className="eyebrow">GOOD COMPANY</span><span className="crew-title">Your travel crew</span><span className="text-sm font-normal">Manage traveler access</span></span></summary>
      <p className="mt-3 text-sm leading-6 text-slate-500">This trip is private. Only you and travelers you add or who accept your invitation can open it. Travelers can view the itinerary and leave feedback; only you can generate or revise it.</p>
      <TripInvitation tripId={tripId} />
      <details className="mt-5"><summary className="text-sm font-semibold">Or add an existing traveler by email</summary>
      <form onSubmit={add} className="mt-5" aria-busy={busy === 'add'}>
        <label htmlFor="traveler-email">Add an existing TripSync traveler</label>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1"><input id="traveler-email" type="email" required maxLength={254} value={email} onChange={event => setEmail(event.target.value)} disabled={busy !== null} placeholder="friend@example.com" aria-describedby="traveler-email-help" /></div>
          <button className="button-primary shrink-0" type="submit" disabled={busy !== null}>{busy === 'add' ? 'Adding traveler…' : 'Add traveler'}</button>
        </div>
        <p id="traveler-email-help" className="mt-2 text-xs text-slate-500">They must have signed in to TripSync before. Use their sign-in email. No invitation email is sent.</p>
      </form></details>
      <div className="mt-4 text-sm" aria-live="polite">
        {error && <p role="alert" className="text-red-700">{error}</p>}
        {message && <p role="status" className="text-teal-800">{message}</p>}
      </div>
      <h3 className="mt-6 font-semibold">Current travelers</h3>
      <div className="crew-person mt-3 text-sm"><TravelerInitials name={travelers.find(member => member.userId === ownerId)?.name} /><div>
        <p className="traveler-name font-semibold">{travelers.find(member => member.userId === ownerId)?.name || 'You'} <span className="ml-2 pill">Owner</span></p>
        <p className="text-slate-500">{travelers.find(member => member.userId === ownerId)?.email}</p>
      </div></div>
      {listError ? <p className="notice mt-4" role="alert">The traveler list could not be loaded. Refresh to try again.</p> : (
        <ul className="mt-3 divide-y divide-slate-100">
          {travelers.filter(member => member.userId !== ownerId).map(member => (
            <li key={member.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="crew-person min-w-0"><TravelerInitials name={member.name} /><div>
                <p className="traveler-name break-words text-sm font-semibold">{member.name || 'Traveler'} <span className="ml-2 pill">Member</span></p>
                <p className="break-all text-xs text-slate-500">{member.email || `Account ${member.userId}`}</p>
              </div></div>
              <button type="button" className="button-secondary" disabled={busy !== null} aria-label={`Remove ${member.name || member.email || member.userId}`} onClick={() => void mutate('DELETE', { user_id: member.userId }, member.userId)}>{busy === member.userId ? 'Removing…' : 'Remove'}</button>
            </li>
          ))}
        </ul>
      )}
      {!listError && !travelers.some(member => member.userId !== ownerId) && <p className="mt-3 text-sm text-slate-500">Only you have access. Share an invitation link to plan together.</p>}
    </details>
  );
}
