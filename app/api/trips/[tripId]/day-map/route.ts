import { dayMapLayout } from '@/lib/day-map-layout';
import { createClient } from '@/lib/supabase/server';
import { accessibleTrip } from '@/lib/feedback-server';
import { validTripId } from '@/lib/itinerary';
import { placesEnabled, resolvePlace } from '@/lib/places';

export const maxDuration = 60;
function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
}
export async function GET(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const query = new URL(request.url).searchParams;
  const versionId = query.get('version');
  const day = Number(query.get('day'));
  if (!validTripId(tripId) || !versionId || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(versionId) || !Number.isInteger(day) || day < 1 || day > 30) return json({}, 400);
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json({}, 401);
    const trip = await accessibleTrip(supabase, tripId, user.id);
    if (!trip) return json({}, 404);
    const version = await supabase.from('itinerary_versions').select('id').eq('id', versionId).eq('trip_id', tripId).maybeSingle();
    if (version.error || !version.data) return json({}, 404);
    const items = await supabase.from('itinerary_items').select('id,title,location').eq('version_id', versionId).eq('day_number', day).order('position');
    if (items.error) return json({}, 503);
    if (!placesEnabled()) return json({ places: [], image: null, status: 'not_configured' });
    // Resolve only saved activities, never arbitrary client-provided search strings.
    const places = [];
    const rows = items.data ?? [];
    for (let index = 0; index < rows.length; index += 5) {
      places.push(...await Promise.all(rows.slice(index, index + 5).map(async item => ({
        itemId: item.id, place: await resolvePlace(item.title, item.location, trip.destination, true),
      }))));
    }
    let image: string | null = null;
    const key = process.env.GOOGLE_MAPS_STATIC_API_KEY || process.env.GOOGLE_PLACES_API_KEY;
    const markers = places.filter(entry => entry.place?.coordinates);
    const layout = dayMapLayout(markers.map(entry => ({ itemId: entry.itemId, ...entry.place!.coordinates!, categoryType: entry.place!.categoryType })));
    if (key && layout) {
      try {
        const url = new URL('https://maps.googleapis.com/maps/api/staticmap');
        url.searchParams.set('key', key);
        url.searchParams.set('size', '640x360');
        url.searchParams.set('scale', '2');
        url.searchParams.set('format', 'png');
        url.searchParams.set('center', `${layout.center.lat},${layout.center.lng}`);
        url.searchParams.set('zoom', String(layout.zoom));
        const response = await fetch(url, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(7000) });
        if (!response.ok) console.warn('[Day map]', { status: response.status });
        if (response.ok && response.headers.get('content-type')?.startsWith('image/png') && !response.headers.get('x-staticmap-api-warning')) {
          const bytes = await response.arrayBuffer();
          if (bytes.byteLength <= 3000000) image = `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`;
        }
      } catch { /* Place links remain useful when the map service is unavailable. */ }
    }
    return json({ places, image, layout: image ? layout : null, status: image ? 'ready' : !markers.length ? 'no_matches' : !key ? 'not_configured' : 'unavailable' });
  } catch { return json({ places: [], image: null }); }
}
