import { resolveTripCover } from '@/lib/destinations';
import { CoverScene } from '@/components/trip-covers/scenes';

export function TripCoverArt({ destination, className = '' }: { destination: string; className?: string }) {
  const cover = resolveTripCover(destination);
  return <svg className={`trip-cover-svg ${className}`} data-theme={cover.theme} viewBox="0 0 640 360" preserveAspectRatio="xMidYMid slice" role="img" aria-label={cover.alt} focusable="false">
    <rect width="640" height="360" fill="#eee9db" />
    <circle cx="489" cy="87" r="42" fill="#e8c78f" />
    <path d="M68 82h82m-60 10h38" stroke="#faf7ee" strokeWidth="4" strokeLinecap="round" />
    <CoverScene theme={cover.theme} />
    <path d="M572 39q0 14-14 14 14 0 14 14 0-14 14-14-14 0-14-14Z" fill="#fff8e7" />
  </svg>;
}
