/* eslint-disable @next/next/no-img-element -- Tiny local poster is the static fallback for a decorative video. */
'use client';
import { useRef, useState, useSyncExternalStore } from 'react';

const mediaQuery = '(min-width: 900px) and (prefers-reduced-motion: no-preference) and (pointer: fine)';
function subscribe(callback: () => void) {
  const media = window.matchMedia(mediaQuery);
  media.addEventListener('change', callback);
  const connection = (navigator as Navigator & { connection?: EventTarget }).connection;
  connection?.addEventListener('change', callback);
  return () => { media.removeEventListener('change', callback); connection?.removeEventListener('change', callback); };
}
function canAnimate() {
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  return window.matchMedia(mediaQuery).matches && !connection?.saveData && !['slow-2g', '2g', '3g'].includes(connection?.effectiveType ?? '');
}
export function LandingVideo({ enabled = true }: { enabled?: boolean }) {
  const eligible = useSyncExternalStore(subscribe, canAnimate, () => false);
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const animated = enabled && eligible && !failed;
  return <div className="landing-video">
    <img src="/media/travel-poster.webp" alt="Illustrated coastal village with a sailboat" width={640} height={400} fetchPriority="high" />
    {animated && <video ref={video} src="/media/travel-loop.mp4" muted autoPlay loop playsInline preload="none" poster="/media/travel-poster.webp" aria-hidden="true"
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => setFailed(true)} />}
    <span className="landing-video-overlay" aria-hidden="true" />
    {animated && <button type="button" className="video-toggle" onClick={() => {
      if (!video.current) return;
      if (video.current.paused) void video.current.play().catch(() => setFailed(true));
      else video.current.pause();
    }} aria-label={playing ? 'Pause decorative video' : 'Play decorative video'}>{playing ? 'Pause' : 'Play'}</button>}
  </div>;
}
