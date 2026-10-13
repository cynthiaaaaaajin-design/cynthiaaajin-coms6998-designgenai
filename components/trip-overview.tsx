'use client';
import { useState } from 'react';

export function TripOverview({ days }: { days: { day: number; summary: string }[] }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? days : days.slice(0, 3);
  return <section className="trip-overview" aria-labelledby="trip-overview-title">
    <p className="eyebrow">AT A GLANCE</p>
    <h3 id="trip-overview-title">Trip overview</h3>
    <ol id="trip-overview-days" aria-label="Daily itinerary overview">{visible.map(({ day, summary }) => (
      <li key={day}><a href={`#day-${day}`}>
        <strong>Day {day}</strong><span>{summary}</span><span aria-hidden="true" className="overview-arrow">↗</span>
      </a></li>
    ))}</ol>
    {days.length > 3 && <button type="button" className="overview-expand" aria-expanded={expanded} aria-controls="trip-overview-days" onClick={() => setExpanded(value => !value)}>{expanded ? 'Show first 3 days' : `View all ${days.length} days`} <span aria-hidden="true">{expanded ? '−' : '+'}</span></button>}
  </section>;
}
