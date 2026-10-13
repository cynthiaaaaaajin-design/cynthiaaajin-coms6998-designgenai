/* eslint-disable @next/next/no-img-element -- Ephemeral Google map with attribution intact; must not use an image cache. */
'use client';
import { useEffect, useRef, useState } from 'react';
import type { dayMapLayout } from '@/lib/day-map-layout';
import type { PlaceInfo } from '@/lib/place-types';

type Stop = { id: string; title: string; location: string | null };
type MapData = { layout?: ReturnType<typeof dayMapLayout>; status?: string; image: string | null; places: { itemId: string; place: PlaceInfo | null }[] };
export function DayMap({ tripId, versionId, day, destination, items }: {
  tripId: string; versionId: string; day: number; destination: string; items: Stop[];
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const anchor = useRef<HTMLElement>(null);
  const [data, setData] = useState<MapData | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const load = () => {
      fetch(`/api/trips/${encodeURIComponent(tripId)}/day-map?version=${encodeURIComponent(versionId)}&day=${day}`, { cache: 'no-store', signal: controller.signal })
        .then(response => { if (!response.ok) throw new Error('Unavailable'); return response.json(); })
        .then(value => { if (!controller.signal.aborted) setData(value); })
        .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    };
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer?.disconnect(); load(); }
    });
    if (observer && anchor.current) observer.observe(anchor.current); else load();
    return () => { observer?.disconnect(); controller.abort(); };
  }, [tripId, versionId, day]);
  const count = data?.places.filter(entry => entry.place?.coordinates).length ?? 0;
  return <section ref={anchor} className="day-map" aria-labelledby={`day-map-${day}`}>
    <div className="section-heading"><p className="eyebrow">EXPLORE DAY {String(day).padStart(2, '0')}</p><h4 id={`day-map-${day}`} className="mt-2 text-2xl font-semibold">On the map</h4></div>
    {data?.image && !failed ? <figure className="day-map-preview">
      <div className="day-map-interactive"><img src={data.image} width={1280} height={720} alt={`Google map showing ${count} resolved stops for day ${day}`} onError={() => setFailed(true)} />
      {data.layout?.markers.map(marker => {
        const entry = data.places.find(entry => entry.itemId === marker.itemId)?.place;
        const order = items.findIndex(item => item.id === marker.itemId) + 1;
        return entry && <button key={marker.itemId} className={`map-place-marker marker-${marker.kind}`} style={{ left: `${marker.x}%`, top: `${marker.y}%` }} onClick={() => setSelected(marker.itemId)} aria-label={`${order}. ${entry.name}, ${marker.kind}`} aria-pressed={selected === marker.itemId}><span aria-hidden="true">{marker.kind === 'food' ? '♨' : marker.kind === 'hotel' ? '▰' : '◆'}</span>{order}</button>;
      })}</div>
      <p className="map-legend">◆ Attraction / other · ♨ Food · ▰ Stay · Select a marker for details</p>
      {selected && (() => { const place = data.places.find(entry => entry.itemId === selected)?.place; return place && <div className="map-selection" role="status"><strong>{place.name}</strong><span>{place.category}</span><a href={place.mapsUrl} target="_blank" rel="noopener noreferrer">Open in Google Maps ↗</a><button onClick={() => setSelected(null)} aria-label="Close place details">×</button></div>; })()}
      <figcaption>{count} of {items.length} stops mapped · Suggested matches; check each place before you go.</figcaption>
    </figure> : <p className="day-map-status" role="status">{!data && !failed ? 'Finding today’s places…' : data?.status === 'not_configured' ? 'Maps are not enabled for this deployment yet. You can still open every stop below.' : data?.status === 'no_matches' ? 'No map locations could be confirmed. Use the links below to find today’s stops.' : 'Google’s map preview is unavailable. You can still open every stop below.'}</p>}
    <ol className="day-map-places">{items.map((item, index) => {
      const place = data?.places.find(entry => entry.itemId === item.id)?.place;
      const href = place?.mapsUrl ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([item.title, item.location, destination].filter(Boolean).join(', '))}`;
      return <li key={item.id}><span className="day-map-number" aria-hidden="true">{index + 1}</span><div className="min-w-0 flex-1"><p className="font-semibold break-words">{place?.name || item.title}</p><p className="mt-1 text-xs text-slate-600">{place?.category || item.location}{!place && data ? ' · Search location' : ''}</p>
        {place?.attributions.map((credit, i) => <p className="places-attribution" key={i}>{credit.uri ? <a href={credit.uri} target="_blank" rel="noopener noreferrer">{credit.name}</a> : credit.name}</p>)}
      </div><a href={href} target="_blank" rel="noopener noreferrer">Open in Google Maps ↗</a></li>;
    })}</ol>
    <p className="places-attribution"><span translate="no">Google Maps</span> · <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>
  </section>;
}
