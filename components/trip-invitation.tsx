'use client';
import { useRef, useState } from 'react';
export function TripInvitation({ tripId }: { tripId: string }) {
  const [link, setLink] = useState('');
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const lock = useRef(false);
  async function update(revoke = false) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setMessage(''); setError('');
    try {
      const response = await fetch(`/api/trips/${tripId}/invitation`, { method: revoke ? 'DELETE' : 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not update invitation.');
      setLink(revoke ? '' : `${window.location.origin}${result.path}`);
      setExpires(revoke ? '' : new Date(result.expiresAt).toLocaleDateString());
      setMessage(revoke ? 'Invitation link revoked. Existing travelers keep their access.' : 'Invitation ready. Copy the link and send it to your friends.');
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not update invitation.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="trip-invitation mt-5" aria-labelledby="invite-title">
    <h3 id="invite-title" className="text-lg font-semibold">Invite anyone to your trip</h3>
    <p className="mt-2 text-sm">Friends can sign up or sign in with Google, then join through your link. Anyone with the link can join, so share it only with your travel crew.</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <button id="create-trip-invitation" type="button" className="button-primary" disabled={busy} onClick={() => void update()}>{busy ? 'Updating…' : link ? 'Replace invitation link' : 'Create invitation link'}</button>
      <button type="button" className="button-secondary" disabled={busy} onClick={() => void update(true)}>Revoke invitation link</button>
    </div>
    <p className="mt-2 text-xs">Links expire after 7 days. Creating a new link replaces any previous link. No invitation email is sent.</p>
    {link && <div className="mt-4"><label htmlFor="trip-invite-link">Invitation link · expires {expires}</label><div className="flex flex-wrap gap-2"><input className="min-w-0 flex-1" id="trip-invite-link" readOnly value={link} onFocus={event => event.target.select()} /><button type="button" className="button-secondary" onClick={async () => { try { await navigator.clipboard.writeText(link); setMessage('Invitation link copied.'); } catch { setMessage('Select and copy the invitation link above.'); } }}>Copy invitation</button></div></div>}
    <div aria-live="polite">{message && <p className="mt-3 text-sm" role="status">{message}</p>}{error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}</div>
  </section>;
}
