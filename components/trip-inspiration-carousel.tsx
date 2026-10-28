'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';

const scenes = [
  { file: 'coast', label: 'By the sea', alt: 'Soft waves washing onto a tropical beach at sunset' },
  { file: 'forest', label: 'Into the forest', alt: 'Sunlight falling across a trail through a green forest' },
  { file: 'alpine-water', label: 'Among the mountains', alt: 'Alpine mountains reflected in a still lake' },
  { file: 'aurora', label: 'Under northern skies', alt: 'Green and violet northern lights above a snowy landscape' },
  { file: 'dunes', label: 'Beyond the horizon', alt: 'Sunlit sandstone formations rising above a wide desert' },
];

export function TripInspirationCarousel() {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (!playing || hovered) return;
    const timer = window.setInterval(() => {
      if (!document.hidden && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setIndex(current => (current + 1) % scenes.length);
      }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [playing, hovered]);

  return <div className="trip-inspiration" role="region" aria-roledescription="carousel" aria-label="Travel inspiration photos"
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={event => { if (!(event.target instanceof Element && event.target.closest('.inspiration-play'))) setPlaying(false); }}>
    {scenes.map((scene, i) => <div key={scene.file} className={`inspiration-slide${index === i ? ' is-active' : ''}`} aria-hidden={index !== i}>
      <Image src={`/media/trip-inspiration/${scene.file}.webp`} alt={scene.alt} fill sizes="(max-width: 800px) 100vw, 500px" preload={i === 0} />
    </div>)}
    <div className="inspiration-shade" aria-hidden="true" />
    <div className="inspiration-topline">
      <span>{scenes[index].label}</span>
      <button type="button" className="inspiration-play" onClick={() => setPlaying(current => !current)} aria-label={playing ? 'Pause inspiration slideshow' : 'Play inspiration slideshow'}>{playing ? 'Pause' : 'Play'}</button>
    </div>
    <div className="inspiration-dots" aria-label="Choose a landscape">
      {scenes.map((scene, i) => <button key={scene.file} type="button" aria-label={`Show ${scene.label.toLowerCase()}`} aria-current={i === index ? 'true' : undefined} onClick={() => { setPlaying(false); setIndex(i); }}><span /></button>)}
    </div>
    <span className="sr-only" aria-live={playing ? 'off' : 'polite'}>Photo {index + 1} of {scenes.length}: {scenes[index].label}</span>
  </div>;
}
