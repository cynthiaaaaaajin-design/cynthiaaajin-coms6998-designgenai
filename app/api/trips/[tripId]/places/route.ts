import { createClient } from '@/lib/supabase/server';
import { accessibleTrip } from '@/lib/feedback-server';
import { validTripId } from '@/lib/itinerary';
import { placesEnabled, resolvePlace } from '@/lib/places';

export const maxDuration = 15;
function json(place: unknown, status = 200) {
  return Response.json({ place }, { status, headers: { 'Cache-Control': 'private, no-store' } });
}
export async function GET(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const itemId = new URL(request.url).searchParams.get('item');
  if (!validTripId(tripId) || !itemId || !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(itemId)) return json(null, 400);
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json(null, 401);
    const trip = await accessibleTrip(supabase, tripId, user.id);
    if (!trip) return json(null, 404);
    if (!placesEnabled()) return json(null);
    const { data: item, error } = await supabase.from('itinerary_items').select('title,location,version_id').eq('id', itemId).maybeSingle();
    if (error || !item) return json(null, 404);
    const version = await supabase.from('itinerary_versions').select('id').eq('id', item.version_id).eq('trip_id', tripId).maybeSingle();
    if (version.error || !version.data) return json(null, 404);
    return json(await resolvePlace(item.title, item.location, trip.destination));
  } catch { return json(null); }
}
