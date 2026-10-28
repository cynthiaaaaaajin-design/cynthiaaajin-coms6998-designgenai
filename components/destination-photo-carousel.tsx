/* eslint-disable @next/next/no-img-element -- Places photo media must not enter the Next image cache. */
'use client';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { DestinationPhoto } from '@/lib/google-places';

export function DestinationPhotoCarousel({ tripId, destination, fallback, endpoint }: { tripId?: string; destination: string; fallback: ReactNode; endpoint?: string }) {
  const photoEndpoint = endpoint ?? `/api/trips/${encodeURIComponent(tripId ?? '')}/destination-photo`;
  const [visible, setVisible] = useState(false);
  const [index, setIndex] = useState(0);
  const [photos, setPhotos] = useState<Record<number, DestinationPhoto | null>>({});
  const current = photos[index];
  const [count, setCount] = useState(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const attempted = useRef(new Set<number>());
  const [retry, setRetry] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const [hovered, setHovered] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer?.disconnect(); }
    });
    if (observer && container.current) observer.observe(container.current);
    else { const timer = setTimeout(() => setVisible(true), 0); return () => clearTimeout(timer); }
    return () => observer?.disconnect();
  }, []);
  useEffect(() => {
    if (!autoPlay || hovered || count < 2 || current === undefined) return;
    const timer = window.setInterval(() => {
      const bounds = container.current?.getBoundingClientRect();
      if (document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches || !bounds || bounds.bottom <= 0 || bounds.top >= window.innerHeight) return;
      setIndex(value => (value + 1) % count);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [autoPlay, hovered, count, current, index]);
  useEffect(() => {
    const attempts = attempted.current;
    if (!visible || index in photos || attempts.has(index)) return;
    attempts.add(index);
    const controller = new AbortController();
    fetch(`${photoEndpoint}?index=${index}`, { cache: 'no-store', signal: controller.signal })
      .then(response => response.ok ? response.json() : { photo: null })
      .then(data => { if (!controller.signal.aborted) { setPhotos(old => ({ ...old, [index]: data.photo ?? null })); setCount(old => data.count ?? data.photo?.count ?? old); } })
      .catch(() => { if (!controller.signal.aborted) setPhotos(old => ({ ...old, [index]: null })); });
    return () => { controller.abort(); attempts.delete(index); };
  // Loaded slides are intentionally retained only for the lifetime of this carousel.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoEndpoint, visible, index, retry]);
  // Navigating back to a loaded slide uses only this mounted component's state.
  function go(next: number) { setAutoPlay(false); if (count) setIndex((next + count) % count); }
  return <div ref={container} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocusCapture={event => { if (!(event.target instanceof Element && event.target.closest('.destination-autoplay'))) setAutoPlay(false); }} className="destination-carousel" role="region" aria-roledescription="carousel" aria-label={`${destination} destination photos`}
    onTouchStart={event => { const touch = event.touches[0]; touchStart.current = { x: touch.clientX, y: touch.clientY }; }}
    onTouchEnd={event => { const start = touchStart.current; const end = event.changedTouches[0]; touchStart.current = null;
      if (start && count > 1 && Math.abs(end.clientX - start.x) > 45 && Math.abs(end.clientX - start.x) > Math.abs(end.clientY - start.y)) go(index + (end.clientX < start.x ? 1 : -1));
    }}>
    {current ? <img key={index} className="destination-photo" src={current.src} alt={`${current.name} — destination view ${index + 1} of ${count}`} onError={() => setPhotos(old => ({ ...old, [index]: null }))} /> : fallback}
    {current && <div className="destination-photo-credit"><span>{current.name} · </span><span translate="no">Google Maps</span>{current.authors.map((author, i) => <span key={i}> · {author.url ? <a href={author.url} target="_blank" rel="noopener noreferrer">{author.name}</a> : author.name}</span>)}</div>}
    {count > 1 && <>
      <button type="button" className="destination-autoplay" aria-label={autoPlay ? 'Pause photo slideshow' : 'Play photo slideshow'} onClick={() => setAutoPlay(value => !value)}>{autoPlay ? 'Pause' : 'Play'}</button>
      <button className="destination-arrow previous" aria-label="Previous destination photo" onClick={() => go(index - 1)}>‹</button>
      <button className="destination-arrow next" aria-label="Next destination photo" onClick={() => go(index + 1)}>›</button>
      <div className="destination-dots">{Array.from({ length: count }, (_, i) => <button key={i} aria-label={`Show destination photo ${i + 1}`} aria-current={i === index ? 'true' : undefined} onClick={() => go(i)}><span /></button>)}</div>
    </>}
    <span className="sr-only" aria-live={autoPlay ? "off" : "polite"}>{current ? `Photo ${index + 1} of ${count}` : current === null ? 'Destination illustration. Photo unavailable.' : 'Loading destination photo.'}</span>
    {current === null && count > 0 && <button className="destination-retry" onClick={() => { attempted.current.delete(index); setPhotos(old => { const next = { ...old }; delete next[index]; return next; }); setRetry(value => value + 1); }}>Retry photo</button>}
  </div>;
}
