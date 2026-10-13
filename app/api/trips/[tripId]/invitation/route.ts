import { randomBytes, createHash } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { validTripId } from '@/lib/itinerary';
import { inviteMutationAllowed, inviteJson as json } from '@/lib/invitations';

type Context = { params: Promise<{ tripId: string }> };
async function manage(request: Request, context: Context, revoke: boolean) {
  if (!inviteMutationAllowed(request)) return json({ error: 'Invalid request origin.' }, 403);
  const { tripId } = await context.params;
  if (!validTripId(tripId)) return json({ error: 'Invalid trip.' }, 400);
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return json({ error: 'Please sign in.' }, 401);
  const token = revoke ? null : randomBytes(32).toString('hex');
  const { data, error } = await supabase.rpc('manage_trip_invitation', {
    p_trip_id: tripId, p_hash: token ? createHash('sha256').update(token).digest('hex') : null,
  });
  if (error) return json({ error: error.code === '42501' ? 'Only the trip owner can manage invitations.' : 'Invitations are unavailable. The trip invitation database setup may need to be installed.' }, error.code === '42501' ? 403 : 503);
  return json(token ? { path: `/invite/${token}`, expiresAt: data } : { revoked: true });
}
export async function POST(request: Request, context: Context) { return manage(request, context, false); }
export async function DELETE(request: Request, context: Context) { return manage(request, context, true); }
