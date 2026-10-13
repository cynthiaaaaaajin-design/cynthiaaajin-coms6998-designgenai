'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
export function AcceptInvitation({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const router = useRouter();
  async function join() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const response = await fetch('/api/invitations/accept', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Could not join this trip.');
      router.replace(result.path); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not join this trip.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <div><button onClick={join} disabled={busy} className="button-primary">{busy ? 'Joining…' : 'Join shared trip'}</button>{error && <p role="alert" className="notice mt-4">{error}</p>}</div>;
}
