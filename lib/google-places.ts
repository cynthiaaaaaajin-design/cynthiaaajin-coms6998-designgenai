import 'server-only';
import { normalizeDestination } from './destinations';

export type DestinationPhoto = {
  src: string; name: string; count: number;
  authors: { name: string; url?: string }[];
};
// Only place IDs are retained. Photo names, metadata and media are never cached.
const ids = new Map<string, { id: string; expires: number }>();
function safeLink(value: unknown) {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}
const normalizedName = (name: string) => name.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
export async function destinationPhoto(destination: string, index: number): Promise<DestinationPhoto | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
  if (!key || !destination.trim() || !Number.isInteger(index) || index < 0 || index > 4) return null;
  const canonical = normalizeDestination(destination).canonical;
  const headers = { 'X-Goog-Api-Key': key, 'Content-Type': 'application/json' };
  const options = { cache: 'no-store' as const, redirect: 'error' as const, signal: AbortSignal.timeout(12000) };
  try {
    let place;
    const cached = ids.get(canonical);
    if (cached && cached.expires > Date.now()) {
      const details = await fetch(`https://places.googleapis.com/v1/places/${cached.id}`, { ...options, headers: { ...headers, 'X-Goog-FieldMask': 'id,displayName,photos' } });
      if (!details.ok) { ids.delete(canonical); return null; }
      place = await details.json();
    } else {
      const result = await fetch('https://places.googleapis.com/v1/places:searchText', {
        ...options, method: 'POST', headers: { ...headers, 'X-Goog-FieldMask': 'places.id,places.displayName,places.photos' },
        body: JSON.stringify({ textQuery: canonical, pageSize: 3, languageCode: 'en' }),
      });
      if (!result.ok) return null;
      const data = await result.json();
      // Never substitute a similarly named business for a destination.
      const expected = normalizedName(canonical.split(',')[0]);
      place = Array.isArray(data.places) ? data.places.find((entry: { displayName?: { text?: string } }) =>
        typeof entry.displayName?.text === 'string' && normalizedName(entry.displayName.text) === expected) : undefined;
      if (!place || typeof place.id !== 'string' || !/^[\w-]+$/.test(place.id)) return null;
      if (ids.size >= 256) ids.delete(ids.keys().next().value!);
      ids.set(canonical, { id: place.id, expires: Date.now() + 30 * 86400000 });
    }
    const photos = Array.isArray(place.photos) ? place.photos.slice(0, 5) : [];
    const photo = photos[index];
    if (!photo || typeof photo.name !== 'string' || !/^places\/[\w-]+\/photos\/[\w-]+$/.test(photo.name)) return null;
    const media = await fetch(`https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=900&maxHeightPx=600&skipHttpRedirect=true`, { ...options, headers: { 'X-Goog-Api-Key': key } });
    if (!media.ok) return null;
    const { photoUri } = await media.json();
    const url = new URL(photoUri);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.googleusercontent.com') || url.username || url.password) return null;
    const image = await fetch(url, options); // No credentials forwarded to media host.
    const mime = image.headers.get('content-type')?.split(';')[0];
    if (!image.ok || !mime || !['image/jpeg', 'image/png', 'image/webp'].includes(mime) || Number(image.headers.get('content-length')) > 1500000) return null;
    const bytes = await image.arrayBuffer();
    if (bytes.byteLength > 1500000) return null;
    return {
      src: `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`,
      name: typeof place.displayName?.text === 'string' ? place.displayName.text : canonical,
      count: photos.length,
      authors: Array.isArray(photo.authorAttributions) ? photo.authorAttributions.filter((author: { displayName?: unknown }) => typeof author.displayName === 'string').map((author: { displayName: string; uri?: string }) => ({ name: author.displayName, url: safeLink(author.uri) })) : [],
    };
  } catch { return null; }
}
