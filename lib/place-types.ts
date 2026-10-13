export type PlaceAttribution = { name: string; uri?: string };
export type PlaceInfo = {
  id: string; name: string; address: string; rating?: number; reviewCount?: number;
  price?: string; mapsUrl: string; directionsUrl: string; reviewsUrl?: string;
  coordinates?: { lat: number; lng: number }; category?: string; categoryType?: string;
  attributions: PlaceAttribution[];
  photo?: { src: string; authors: PlaceAttribution[]; mapsUrl?: string };
};
