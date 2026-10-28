import { DestinationPhotoCarousel } from './destination-photo-carousel';
import { TripCoverArt } from './trip-cover-art';
export function CommunityPhoto({ id, destination }: { id: string; destination: string }) {
  return <div className="community-photo"><DestinationPhotoCarousel key={id} endpoint={`/api/community/${encodeURIComponent(id)}/photo`} destination={destination} fallback={<TripCoverArt destination={destination}/>} /></div>;
}
