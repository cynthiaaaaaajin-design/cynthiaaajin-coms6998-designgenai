import { createClient } from '@/lib/supabase/server';
import { parseNewTrip } from '@/lib/create-trip';
import { validTripId } from '@/lib/itinerary';

function json(body: object, status: number) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
    return json({ error: 'Invalid request origin.' }, 403);
  }
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return json({ error: 'Please sign in to create a trip.' }, 401);
  let trip;
  try {
    const body = await request.text();
    if (body.length > 4096) return json({ error: 'Trip details are too long.' }, 400);
    trip = parseNewTrip(JSON.parse(body));
  } catch (error) {
    return json({ error: error instanceof SyntaxError ? 'Send valid trip details.' : error instanceof Error ? error.message : 'Invalid trip details.' }, 400);
  }
  // Whitelisted fields only. The authenticated session supplies ownership.
  const { data, error } = await supabase.from('trips')
    .insert({ ...trip, user_id: user.id }).select('id::text').maybeSingle();
  if (error || !data || typeof data.id !== 'string' || !validTripId(data.id)) {
    console.error('[Trip creation]', JSON.stringify({
      operation: 'insert', table: 'trips', returning: 'id::text',
      error: error ? { code: error.code, message: error.message, details: error.details, hint: error.hint } : null,
      returnedIdType: typeof data?.id, returnedRow: !!data,
    }));
    return json({ error: 'The trip could not be confirmed as saved. Check My Trips before trying again.' }, 500);
  }
  return json({ tripId: data.id }, 201);
}
