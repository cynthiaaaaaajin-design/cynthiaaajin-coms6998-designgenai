import type { ReactNode } from 'react';
import { DestinationPhotoCarousel } from './destination-photo-carousel';
export function DestinationCoverPhoto({tripId,destination,fallback}:{tripId:string;destination:string;fallback:ReactNode}) {
  return <div className="destination-cover-photo"><DestinationPhotoCarousel key={tripId} tripId={tripId} destination={destination} fallback={fallback}/></div>;
}
