import { destinationStops } from '@/lib/destinations';
import { createClient } from '@/lib/supabase/server';
import { accessibleTrip } from '@/lib/feedback-server';
import { validTripId } from '@/lib/itinerary';
import { destinationPhoto } from '@/lib/google-places';
export const maxDuration = 20;
function json(photo: unknown, status = 200, count?: number) {
  return Response.json({ photo, count }, { status, headers: { 'Cache-Control': 'private, no-store' } });
}
export async function GET(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const index = Number(new URL(request.url).searchParams.get('index') ?? 0);
  if (!validTripId(tripId) || !Number.isInteger(index) || index < 0 || index > 4) return json(null, 400);
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return json(null, 401);
    const trip = await accessibleTrip(supabase, tripId, user.id);
    if (!trip) return json(null, 404);
    const stops = destinationStops(trip.destination ?? '').slice(0, 5);
    if (stops.length > 1) {
      if (index >= stops.length) return json(null, 400, stops.length);
      const photo = await destinationPhoto(stops[index], 0);
      return json(photo ? { ...photo, count: stops.length } : null, 200, stops.length);
    }
    const photo = await destinationPhoto(stops[0] ?? '', index);
    return json(photo, 200, photo?.count ?? 0);
  } catch { return json(null); }
}
