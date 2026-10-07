import { createClient } from '@/lib/supabase/server';
import { validTripId } from '@/lib/itinerary';
import { travelerEmail, travelerId } from '@/lib/travelers';
import { loadTravelers } from '@/lib/travelers-server';

type Context = { params: Promise<{ tripId: string }> };
function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

async function ownerContext(request: Request, context: Context) {
  const { tripId } = await context.params;
  if (!validTripId(tripId)) return { response: json({ error: 'Invalid trip ID.' }, 400) };
  if (request.method !== 'GET') {
    const origin = request.headers.get('origin');
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
      return { response: json({ error: 'Invalid request origin.' }, 403) };
    }
  }
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { response: json({ error: 'Please log in to manage travelers.' }, 401) };
  const { data: trip, error } = await supabase.from('trips').select('user_id')
    .eq('id', tripId).eq('user_id', user.id).maybeSingle();
  if (error) return { response: json({ error: 'Trip ownership could not be checked.' }, 500) };
  if (!trip) return { response: json({ error: 'Trip not found or you are not its owner.' }, 404) };
  return { supabase, tripId, user };
}

async function body(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text.length > 2048) throw new Error('The request is too long.');
  try { return JSON.parse(text); } catch { throw new Error('Send valid traveler details.'); }
}

export async function GET(request: Request, context: Context) {
  const owner = await ownerContext(request, context);
  if (owner.response) return owner.response;
  try {
    return json({ travelers: await loadTravelers(owner.supabase, owner.tripId) });
  } catch {
    return json({ error: 'Travelers could not be loaded. Please refresh to try again.' }, 500);
  }
}

export async function POST(request: Request, context: Context) {
  const owner = await ownerContext(request, context);
  if (owner.response) return owner.response;
  let email: string;
  try { email = travelerEmail(await body(request)); }
  catch (error) { return json({ error: error instanceof Error ? error.message : 'Invalid email.' }, 400); }

  const { data: result, error } = await owner.supabase.rpc('add_trip_member_by_email', {
    p_trip_id: owner.tripId,
    p_email: email,
  });
  if (error) return json({ error: 'The traveler could not be added. Please try again.' }, error.code === '42501' ? 403 : 500);
  switch (result) {
    case 'success':
      return json({ result, message: 'Traveler added.' }, 201);
    case 'already_member':
      return json({ result, message: 'This traveler already has access.' });
    case 'invalid_email':
      return json({ result, error: 'Enter a valid email address.' }, 400);
    case 'user_not_found':
      return json({ result, error: 'No TripSync account was found for this email. Ask them to sign in first.' }, 404);
    case 'cannot_add_owner':
      return json({ result, error: 'You are already the owner of this trip.' }, 400);
    default:
      return json({ error: 'The traveler could not be added. Please try again.' }, 500);
  }
}

export async function DELETE(request: Request, context: Context) {
  const owner = await ownerContext(request, context);
  if (owner.response) return owner.response;
  let userId: string;
  try { userId = travelerId(await body(request)); }
  catch (error) { return json({ error: error instanceof Error ? error.message : 'Invalid traveler.' }, 400); }
  if (userId === owner.user.id) return json({ error: 'The trip owner cannot be removed.' }, 400);
  const { data, error } = await owner.supabase.from('trip_members').delete()
    .eq('trip_id', owner.tripId).eq('user_id', userId).select('user_id');
  if (error) return json({ error: 'The traveler could not be removed. Please check your trip access and try again.' }, error.code === '42501' ? 403 : 500);
  if (!data?.length) return json({ error: 'No traveler was removed. Refresh the list and check your removal permissions.' }, 409);
  return json({ removedUserId: userId });
}
