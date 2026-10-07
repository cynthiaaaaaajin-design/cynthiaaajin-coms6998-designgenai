/** Pure, deterministic place matching. Unknown places are never guessed geographically. */
export type TravelTheme = 'beach' | 'island' | 'europe-city' | 'asia-city' | 'mountain' | 'desert' | 'forest' | 'tropical' | 'generic';
export type NormalizedDestination = {
  raw: string; city?: string; region?: string; country?: string;
  canonical: string; slug: string; theme: TravelTheme;
};
type Place = Omit<NormalizedDestination, 'raw' | 'slug'> & { aliases: string[] };
const places: Place[] = [
  { canonical: 'Tokyo, Japan', city: 'Tokyo', country: 'Japan', theme: 'asia-city', aliases: ['tokyo', '东京', '東京'] },
  { canonical: 'Lisbon, Portugal', city: 'Lisbon', country: 'Portugal', theme: 'europe-city', aliases: ['lisbon', 'lisboa', '里斯本'] },
  { canonical: 'Miami, Florida, USA', city: 'Miami', region: 'Florida', country: 'USA', theme: 'beach', aliases: ['miami', 'miami fl', 'miami florida', 'miami fl usa', '迈阿密'] },
  { canonical: 'Puerto Rico', region: 'Puerto Rico', theme: 'island', aliases: ['pr', '波多黎各'] },
  { canonical: 'Seoul, South Korea', city: 'Seoul', country: 'South Korea', theme: 'asia-city', aliases: ['seoul', 'seoul korea', '首尔', '首爾'] },
  { canonical: 'Paris, France', city: 'Paris', country: 'France', theme: 'europe-city', aliases: ['paris', '巴黎'] },
  { canonical: 'Rome, Italy', city: 'Rome', country: 'Italy', theme: 'europe-city', aliases: ['rome', 'roma', '罗马'] },
  { canonical: 'Kyoto, Japan', city: 'Kyoto', country: 'Japan', theme: 'asia-city', aliases: ['kyoto', '京都'] },
  { canonical: 'Bali, Indonesia', region: 'Bali', country: 'Indonesia', theme: 'tropical', aliases: ['bali', '巴厘岛'] },
  { canonical: 'Honolulu, Hawaii, USA', city: 'Honolulu', region: 'Hawaii', country: 'USA', theme: 'beach', aliases: ['honolulu', 'hawaii', 'honolulu hawaii', '夏威夷'] },
  { canonical: 'Dolomites, Italy', region: 'Dolomites', country: 'Italy', theme: 'mountain', aliases: ['dolomites', 'the dolomites italy', 'the dolomites'] },
];
const clean = (value: string) => value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
const key = (value: string) => clean(value).toLocaleLowerCase('en-US').replace(/[,，]+/gu, ' ').replace(/\s+/gu, ' ').trim();
const lookup = new Map(places.flatMap(place => [place.canonical, ...place.aliases].map(alias => [key(alias), place] as const)));
const titleCase = (value: string) => value.toLocaleLowerCase('en-US').replace(/(^|[\s,\-/])\p{L}/gu, letter => letter.toLocaleUpperCase('en-US')).replace(/\b(usa|uk|uae)\b/gi, word => word.toUpperCase());
export function normalizeDestination(input: string): NormalizedDestination {
  const place = lookup.get(key(input));
  const canonical = place?.canonical ?? (titleCase(clean(input).replace(/\s*[,，]\s*/gu, ', ')) || 'Somewhere Wonderful');
  const slug = canonical.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
  return { raw: input, canonical, slug, theme: place?.theme ?? 'generic', ...(place?.city && { city: place.city }), ...(place?.region && { region: place.region }), ...(place?.country && { country: place.country }) };
}
export function resolveTripCover(destination: string) {
  const place = normalizeDestination(destination);
  return { normalizedDestination: place.canonical, theme: place.theme, imageType: 'svg' as const, alt: `Abstract ${place.theme.replaceAll('-', ' ')} travel illustration for ${place.canonical}` };
}
