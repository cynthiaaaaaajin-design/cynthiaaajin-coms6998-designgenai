import { createClient } from '@/lib/supabase/server';
import { validTripId } from '@/lib/itinerary';

function json(body: object, status: number) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}
export async function DELETE(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const origin = request.headers.get('origin');
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'Invalid request origin.' }, 403);
  const { tripId } = await params;
  if (!validTripId(tripId)) return json({ error: 'Invalid trip.' }, 400);
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return json({ error: 'Please sign in again.' }, 401);
  // One atomic delete under existing RLS and foreign-key rules. Never partially delete children.
  const { data, error } = await supabase.from('trips').delete().eq('id', tripId).eq('user_id', user.id).select('id');
  if (error) return json({ error: 'This trip could not be deleted. Your saved data is unchanged. Please try again or contact support.' }, 409);
  if (!data?.length) return json({ error: 'Trip not found or deletion is not permitted.' }, 403);
  return json({ deleted: true }, 200);
}
