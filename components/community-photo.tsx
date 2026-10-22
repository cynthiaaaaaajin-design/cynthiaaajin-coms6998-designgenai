/* eslint-disable @next/next/no-img-element -- Uses the existing attributed Google Places photo flow. */
'use client';
import { useEffect, useRef, useState } from 'react';
import type { DestinationPhoto } from '@/lib/google-places';
import { TripCoverArt } from './trip-cover-art';
export function CommunityPhoto({ id, destination }: { id: string; destination: string }) {
  const container = useRef<HTMLDivElement>(null);
  const [photo, setPhoto] = useState<DestinationPhoto | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const load = () => fetch(`/api/community/${id}/photo`, { signal: controller.signal, cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(data => { if (!controller.signal.aborted) setPhoto(data?.photo ?? null); }).catch(() => {});
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer?.disconnect(); load(); }
    });
    if (observer && container.current) observer.observe(container.current); else load();
    return () => { observer?.disconnect(); controller.abort(); };
  }, [id]);
  return <div className="community-photo" ref={container}>{photo ? <><img src={photo.src} alt={destination} onError={() => setPhoto(null)}/><div className="community-photo-credit"><span translate="no">Google Maps</span>{photo.authors.map((a, i) => <span key={i}> · {a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer">{a.name}</a> : a.name}</span>)}</div></> : <TripCoverArt destination={destination}/>}</div>;
}
