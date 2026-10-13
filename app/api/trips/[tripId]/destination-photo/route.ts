import { createClient } from '@/lib/supabase/server';
import { accessibleTrip } from '@/lib/feedback-server';
import { validTripId } from '@/lib/itinerary';
import { destinationPhoto } from '@/lib/google-places';
export const maxDuration = 20;
function json(photo: unknown, status = 200) {
  return Response.json({ photo }, { status, headers: { 'Cache-Control': 'private, no-store' } });
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
    return json(await destinationPhoto(trip.destination ?? '', index));
  } catch { return json(null); }
}
