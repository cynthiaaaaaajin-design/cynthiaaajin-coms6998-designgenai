import { createClient } from '@/lib/supabase/server';
import { validTripId } from '@/lib/itinerary';
import { validInviteToken, inviteMutationAllowed, inviteJson as json } from '@/lib/invitations';
export async function POST(request: Request) {
  if (!inviteMutationAllowed(request)) return json({ error: 'Invalid request origin.' }, 403);
  let token: unknown;
  try { const raw = await request.text(); if (raw.length > 256) throw new Error(); token = JSON.parse(raw)?.token; }
  catch { return json({ error: 'Invalid invitation.' }, 400); }
  if (!validInviteToken(token)) return json({ error: 'Invalid invitation.' }, 400);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: 'Please sign in to join this trip.' }, 401);
  const { data, error } = await supabase.rpc('accept_trip_invitation', { p_token: token });
  if (error) return json({ error: 'Joining is temporarily unavailable. Please try again or contact the trip owner.' }, 503);
  if (['joined','already_member'].includes(data?.result) && validTripId(data.tripId)) return json({ path: `/trips/${data.tripId}` });
  if (data?.result === 'profile_missing') return json({ error: 'Your traveler profile could not be created. Please contact the trip owner for help.' }, 409);
  if (data?.result === 'unverified') return json({ error: 'Please sign in with a verified Google account.' }, 403);
  return json({ error: 'This invitation has expired or been revoked. Ask the trip owner for a new link.' }, 410);
}
