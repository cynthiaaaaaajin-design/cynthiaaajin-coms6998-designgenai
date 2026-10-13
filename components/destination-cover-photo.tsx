/* eslint-disable @next/next/no-img-element -- Ephemeral attributed Places media, outside the image cache. */
'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { DestinationPhoto } from '@/lib/google-places';

export function DestinationCoverPhoto({ tripId, destination, fallback }: { tripId: string; destination: string; fallback: ReactNode }) {
  const container = useRef<HTMLDivElement>(null);
  const [photo, setPhoto] = useState<DestinationPhoto | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const load = () => {
      fetch(`/api/trips/${encodeURIComponent(tripId)}/destination-photo?index=0`, { cache: 'no-store', signal: controller.signal })
        .then(response => response.ok ? response.json() : null)
        .then(data => { if (!controller.signal.aborted) setPhoto(data?.photo ?? null); })
        .catch(() => {});
    };
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer?.disconnect(); load(); }
    });
    if (observer && container.current) observer.observe(container.current); else load();
    return () => { observer?.disconnect(); controller.abort(); };
  }, [tripId]);
  return <div className="destination-cover-photo" ref={container}>
    {photo ? <><img src={photo.src} alt={`${photo.name || destination} destination landscape`} onError={() => setPhoto(null)} />
      <div className="destination-photo-credit"><span translate="no">Google Maps</span>{photo.authors.map((author, index) => <span key={index}> · {author.url ? <a href={author.url} target="_blank" rel="noopener noreferrer">{author.name}</a> : author.name}</span>)}</div>
    </> : fallback}
  </div>;
}
