'use client';

import { useEffect, useState } from 'react';

type Stop = { id: string; label: string; location?: string };
export function ItineraryNavigation({ days }: { days: { day: number; location: string }[] }) {
  const stops: Stop[] = [{ id: 'trip-top', label: '↑ Trip overview' }, ...days.map(({ day, location }) => ({ id: `day-${day}`, label: `Day ${day}`, location })), { id: 'trip-end', label: '↓ End of trip' }];
  const [active, setActive] = useState('trip-top');
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const ids = ['trip-top', ...days.map(({ day }) => `day-${day}`), 'trip-end'];
    let frame = 0;
    const update = () => {
      frame = 0;
      let current = ids[0];
      for (const id of ids) {
        if ((document.getElementById(id)?.getBoundingClientRect().top ?? Infinity) <= 160) current = id;
      }
      if (window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4) current = 'trip-end';
      setActive(current);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); };
  }, [days]);
  const index = Math.max(0, stops.findIndex(stop => stop.id === active));
  return <nav className="itinerary-jump-nav" aria-label="Itinerary day navigation">
    <button className="itinerary-jump-toggle" aria-expanded={open} aria-controls="itinerary-jump-list" onClick={() => setOpen(!open)}>Your itinerary · {stops[index].label} <span aria-hidden="true">{open ? '−' : '+'}</span></button>
    <div id="itinerary-jump-list" className={`itinerary-jump-panel ${open ? 'is-open' : ''}`}>
      <p className="eyebrow">YOUR ITINERARY</p>
      <div className="itinerary-jump-track" aria-hidden="true"><span style={{ width: `${index / (stops.length - 1) * 100}%` }} /></div>
      <ol>{stops.map(stop => <li key={stop.id}><a href={`#${stop.id}`} aria-current={active === stop.id ? 'location' : undefined} onClick={event => {
        const target = document.getElementById(stop.id);
        if (!target) return;
        event.preventDefault();
        target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
        target.focus({ preventScroll: true });
        setOpen(false);
      }}><strong>{stop.label}</strong>{stop.location && <span title={stop.location}>{stop.location}</span>}</a></li>)}</ol>
    </div>
  </nav>;
}
