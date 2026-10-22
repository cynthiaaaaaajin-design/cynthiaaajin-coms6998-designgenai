/* eslint-disable @next/next/no-img-element -- Small attributed Places images are ephemeral data URLs, not cacheable assets. */
'use client';
import { ArrowIcon } from "@/components/arrow-icon";
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { PlaceInfo } from '@/lib/place-types';

export function PlaceEnrichment({ tripId, itemId }: { tripId: string; itemId: string }) {
  const anchor = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<PlaceInfo | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const controller = new AbortController();
    let started = false;
    const observer = new IntersectionObserver(entries => {
      if (started || !entries.some(entry => entry.isIntersecting)) return;
      started = true;
      observer.disconnect();
      fetch(`/api/trips/${encodeURIComponent(tripId)}/places?item=${encodeURIComponent(itemId)}`, { cache: 'no-store', signal: controller.signal })
        .then(response => response.ok ? response.json() : null)
        .then(data => { if (!controller.signal.aborted && data?.place) setPlace(data.place); })
        .catch(() => {}); // Optional enhancement: the itinerary remains usable on every failure.
    });
    if (anchor.current) observer.observe(anchor.current);
    return () => { observer.disconnect(); controller.abort(); };
  }, [tripId, itemId]);
  const details = place ? [
    place.rating !== undefined ? `★ ${place.rating.toFixed(1)}` : null,
    place.reviewCount !== undefined ? `${new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(place.reviewCount)} reviews` : null,
    place.price,
  ].filter(Boolean) : [];
  return <div ref={anchor} className={place ? 'place-enrichment' : 'place-enrichment-anchor'}>
    {place && <>
      <div className="place-summary">
        {place.photo && !photoFailed && <figure className="place-photo">
          <img src={place.photo.src} alt={place.name} width={120} height={90} loading="lazy" onError={() => setPhotoFailed(true)} />
          <figcaption>{place.photo.authors.map((author, index) => <span key={index}>{author.uri ? <a href={author.uri} target="_blank" rel="noopener noreferrer">{author.name}</a> : author.name}{index < place.photo!.authors.length - 1 ? ', ' : ''}</span>)}
            {place.photo.mapsUrl && <a href={place.photo.mapsUrl} target="_blank" rel="noopener noreferrer">View photo</a>}
          </figcaption>
        </figure>}
        <div className="min-w-0">
          <p className="eyebrow">SUGGESTED PLACE</p>
          <p className="mt-1 font-semibold">{place.name}</p>
          {place.address && <p className="mt-1 text-xs text-slate-600">{place.address}</p>}
          {details.length > 0 && <p className="place-metadata">{details.join(' · ')}</p>}
        </div>
      </div>
      <div className="place-links">
        <a href={place.mapsUrl} target="_blank" rel="noopener noreferrer">View on Google Maps <ArrowIcon /></a>
        <a href={place.directionsUrl} target="_blank" rel="noopener noreferrer">Directions <ArrowIcon /></a>
        {place.reviewsUrl && <a href={place.reviewsUrl} target="_blank" rel="noopener noreferrer">Reviews <ArrowIcon /></a>}
      </div>
      <p className="places-attribution"><span translate="no">Google Maps</span>{place.attributions.map((author, index) => <span key={index}> · {author.uri ? <a href={author.uri} target="_blank" rel="noopener noreferrer">{author.name}</a> : author.name}</span>)}</p>
      <div className="mt-2 flex gap-3 text-xs text-slate-600"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div>
    </>}
  </div>;
}
