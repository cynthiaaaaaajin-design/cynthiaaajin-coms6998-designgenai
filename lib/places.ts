import 'server-only';
import type { PlaceInfo, PlaceAttribution } from './place-types';

export const PLACES_FIELDS = [
  'places.id', 'places.displayName', 'places.formattedAddress', 'places.rating',
  'places.userRatingCount', 'places.priceLevel', 'places.photos', 'places.attributions',
  'places.googleMapsLinks.placeUri', 'places.googleMapsLinks.directionsUri', 'places.googleMapsLinks.reviewsUri',
].join(',');
export function placesEnabled() {
  return process.env.GOOGLE_PLACES_ENABLED !== 'false' && !!process.env.GOOGLE_PLACES_API_KEY;
}
export function safeGoogleLink(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    if (url.protocol === 'https:' && !url.username && !url.password &&
      (url.hostname === 'google.com' || url.hostname.endsWith('.google.com') || url.hostname === 'maps.app.goo.gl')) return url.href;
  } catch { /* Omit malformed links. */ }
}
function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
function tokens(value: string) { return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []; }
const generic = new Set('a an the in at of to for and visit explore breakfast lunch dinner walk walking tour free time leisure hotel restaurant cafe local city center centre check out relax arrival departure transfer airport'.split(' '));
// Conservative name overlap: generic activities must not become arbitrary businesses.
export function plausiblePlace(name: string, title: string, location: string, destination: string) {
  const excluded = new Set([...generic, ...tokens(destination)]);
  const specific = tokens(`${title} ${location}`).filter(token => token.length > 2 && !excluded.has(token));
  const nameTokens = tokens(name).filter(token => token.length > 2 && !excluded.has(token));
  return specific.length > 0 && nameTokens.length > 0 && nameTokens.filter(token => specific.includes(token)).length / nameTokens.length >= 0.6;
}
function attributionLink(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value.startsWith('//') ? `https:${value}` : value);
    if (url.protocol === 'https:' && !url.username && !url.password) return url.href;
  } catch { /* Omit unsafe attribution links, retaining their text. */ }
}
function authors(rows: unknown, provider = false): PlaceAttribution[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(row => ({ name: text(provider ? row?.provider : row?.displayName), uri: attributionLink(provider ? row?.providerUri : row?.uri) })).filter(row => row.name);
}
async function photoData(photo: { name?: string; authorAttributions?: unknown; googleMapsUri?: string }, key: string): Promise<PlaceInfo['photo']> {
  if (!photo.name || !/^places\/[\w-]+\/photos\/[\w-]+$/.test(photo.name)) return;
  try {
    const response = await fetch(`https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=320&maxHeightPx=240&skipHttpRedirect=true`, {
      headers: { 'X-Goog-Api-Key': key }, cache: 'no-store', signal: AbortSignal.timeout(2500), redirect: 'error',
    });
    if (!response.ok) return;
    const { photoUri } = await response.json();
    const url = new URL(photoUri);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.googleusercontent.com') || url.username || url.password) return;
    // Fetch media without credentials; no key-bearing URL or upstream error reaches the browser.
    const image = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(2500), redirect: 'error' });
    const mime = image.headers.get('content-type')?.split(';')[0];
    if (!image.ok || !mime || !['image/jpeg', 'image/png', 'image/webp'].includes(mime) || Number(image.headers.get('content-length')) > 350000) return;
    const buffer = await image.arrayBuffer();
    if (buffer.byteLength > 350000) return;
    return { src: `data:${mime};base64,${Buffer.from(buffer).toString('base64')}`, authors: authors(photo.authorAttributions), mapsUrl: safeGoogleLink(photo.googleMapsUri) };
  } catch { return; }
}
export async function resolvePlace(title: string, location: string | null, destination: string | null, mapOnly = false): Promise<PlaceInfo | null> {
  if (!placesEnabled() || !destination?.trim()) return null;
  const key = process.env.GOOGLE_PLACES_API_KEY!;
  try {
    const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': mapOnly ? 'places.id,places.displayName,places.formattedAddress,places.location,places.primaryTypeDisplayName,places.primaryType,places.attributions,places.googleMapsLinks.placeUri' : PLACES_FIELDS },
      body: JSON.stringify({ textQuery: [title, location, destination].filter(Boolean).join(', ').slice(0, 700), pageSize: 3, languageCode: 'en' }),
      cache: 'no-store', signal: AbortSignal.timeout(4500), redirect: 'error',
    });
    if (!response.ok) { console.warn('[Places lookup]', { status: response.status }); return null; }
    const data = await response.json();
    if (!Array.isArray(data.places)) return null;
    const match = data.places.find((place: { id?: string; displayName?: { text?: string } }) =>
      typeof place.id === 'string' && /^[\w-]+$/.test(place.id) && plausiblePlace(text(place.displayName?.text), title, location ?? '', destination));
    if (!match) return null;
    const name = text(match.displayName?.text);
    const query = encodeURIComponent(`${name} ${text(match.formattedAddress)}`);
    const id = encodeURIComponent(match.id);
    const price = ({ PRICE_LEVEL_FREE: 'Free', PRICE_LEVEL_INEXPENSIVE: '$', PRICE_LEVEL_MODERATE: '$$', PRICE_LEVEL_EXPENSIVE: '$$$', PRICE_LEVEL_VERY_EXPENSIVE: '$$$$' } as Record<string, string>)[match.priceLevel];
    return {
      id: match.id, name,
      coordinates: Number.isFinite(match.location?.latitude) && Math.abs(match.location.latitude) <= 90 && Number.isFinite(match.location?.longitude) && Math.abs(match.location.longitude) <= 180 ? { lat: match.location.latitude, lng: match.location.longitude } : undefined,
      category: text(match.primaryTypeDisplayName?.text) || undefined,
      categoryType: text(match.primaryType) || undefined,
      address: text(match.formattedAddress),
      rating: typeof match.rating === 'number' && match.rating >= 0 && match.rating <= 5 ? match.rating : undefined,
      reviewCount: Number.isInteger(match.userRatingCount) && match.userRatingCount >= 0 ? match.userRatingCount : undefined,
      price, mapsUrl: safeGoogleLink(match.googleMapsLinks?.placeUri) ?? `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${id}`,
      directionsUrl: safeGoogleLink(match.googleMapsLinks?.directionsUri) ?? `https://www.google.com/maps/dir/?api=1&destination=${query}&destination_place_id=${id}`,
      reviewsUrl: safeGoogleLink(match.googleMapsLinks?.reviewsUri), attributions: authors(match.attributions, true),
      photo: !mapOnly && Array.isArray(match.photos) && match.photos[0] ? await photoData(match.photos[0], key) : undefined,
    };
  } catch { return null; }
}
