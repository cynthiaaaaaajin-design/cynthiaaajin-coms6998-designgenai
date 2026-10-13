import { DestinationPhotoCarousel } from '@/components/destination-photo-carousel';
import { TripCoverArt } from '@/components/trip-cover-art';
import { normalizeDestination } from '@/lib/destinations';

export function DestinationHero({ tripId, destination }: { tripId: string; destination: string }) {
  const illustration = <TripCoverArt destination={destination} />;
  if (!process.env.GOOGLE_MAPS_API_KEY && !process.env.GOOGLE_PLACES_API_KEY) return illustration;
  return <DestinationPhotoCarousel key={`${tripId}:${destination}`} tripId={tripId} destination={normalizeDestination(destination).canonical} fallback={illustration} />;
}
