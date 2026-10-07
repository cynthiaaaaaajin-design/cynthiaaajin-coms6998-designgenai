'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

export function ItineraryVersionSelector({ tripId, versions, selectedId }: {
  tripId: string;
  versions: { id: string; version_number: number }[];
  selectedId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="mt-5" aria-busy={pending}>
      <label htmlFor="itinerary-version">View itinerary version</label>
      <select id="itinerary-version" className="ml-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" value={selectedId} disabled={pending}
        onChange={event => {
          const id = event.target.value;
          startTransition(() => router.push(`/trips/${encodeURIComponent(tripId)}?version=${encodeURIComponent(id)}`, { scroll: false }));
        }}>
        {versions.map((version, index) => <option key={version.id} value={version.id}>Version {version.version_number}{index === 0 ? ' (current)' : ''}</option>)}
      </select>
      {pending && <p role="status" className="mt-2 text-sm text-teal-800">Loading version…</p>}
    </div>
  );
}
