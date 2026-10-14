import { createClient } from '@/lib/supabase/server';
import { accessibleTrip } from '@/lib/feedback-server';
import { validTripId } from '@/lib/itinerary';
export function collaborationJson(body: object, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}
export async function collaborationAccess(request: Request, tripId: string) {
  if (!validTripId(tripId)) return collaborationJson({ error: 'Invalid trip ID.' }, 400);
  const origin = request.headers.get('origin');
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') return collaborationJson({ error: 'Invalid request origin.' }, 403);
  const client = await createClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return collaborationJson({ error: 'Please sign in.' }, 401);
  const trip = await accessibleTrip(client, tripId, user.id);
  if (!trip) return collaborationJson({ error: 'Trip not found or access unavailable.' }, 404);
  return { client, user, trip };
}
export async function collaborationBody(request: Request, maxLength = 40000): Promise<unknown> {
  const body = await request.text();
  if (body.length > maxLength) throw new Error('Form is too long.');
  try { return JSON.parse(body); } catch { throw new Error('Send valid JSON.'); }
}
