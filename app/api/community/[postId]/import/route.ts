import { createClient } from '@/lib/supabase/server';
import { uuid } from '@/lib/community';
import { parseNewTrip } from '@/lib/create-trip';
import { validTripId } from '@/lib/itinerary';
function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}
export async function POST(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  if (!uuid(postId)) return json({ error: 'Invalid publication.' }, 400);
  if (request.headers.get('sec-fetch-site') === 'cross-site' || (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin)) return json({ error: 'Invalid request origin.' }, 403);
  const client = await createClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return json({ error: 'Sign in to save a copy.' }, 401);
  let start_date: string;
  try {
    const raw = await request.text();
    if (raw.length > 1024) throw new Error('Request is too long.');
    const input = JSON.parse(raw);
    start_date = parseNewTrip({ title: 'Copy', destination: 'Copy', start_date: input.start_date, end_date: input.start_date }).start_date;
  } catch { return json({ error: 'Choose a valid start date.' }, 400); }
  const { data, error } = await client.rpc('import_community_trip', { p_post_id: postId, p_start_date: start_date });
  if (error) return json({ error: error.code === '22023' ? error.message : 'Could not save this copy. Please verify Community import setup and try again.' }, error.code === '22023' ? 400 : 503);
  if (typeof data !== 'string' || !validTripId(data)) return json({ error: 'Could not confirm the saved copy. Check My trips before retrying.' }, 500);
  return json({ tripId: data }, 201);
}
