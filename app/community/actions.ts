'use server';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { validTripId } from '@/lib/itinerary';
import { uuid } from '@/lib/community';
export type CommunityState = { error?: string; success?: string };
export async function publishTrip(_state: CommunityState, form: FormData): Promise<CommunityState> {
  const tripId = String(form.get('tripId') ?? '');
  const description = String(form.get('description') ?? '').trim();
  const mode = form.get('mode');
  if (!validTripId(tripId) || description.length > 2000 || !['publish','withdraw'].includes(String(mode))) return { error: 'Check the publication details.' };
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { error: 'Sign in before publishing.' };
  const { error } = mode === 'withdraw'
    ? await client.rpc('withdraw_community_trip', { p_trip_id: tripId })
    : await client.rpc('publish_community_trip', { p_trip_id: tripId, p_description: description });
  if (error) return { error: 'Could not update this publication. Check that you own this trip, have a complete itinerary, and that the publication has not been hidden by an administrator.' };
  revalidatePath('/community', 'layout');
  revalidatePath(`/trips/${tripId}`);
  return { success: mode === 'withdraw' ? 'Your community publication has been withdrawn.' : 'Your current itinerary has been published to Community.' };
}
export async function ratePost(_state: CommunityState, form: FormData): Promise<CommunityState> {
  const id = String(form.get('postId') ?? '');
  const value = Number(form.get('value'));
  if (!uuid(id) || ![-1,0,1].includes(value)) return { error: 'Invalid rating.' };
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { error: 'Sign in to rate this itinerary.' };
  const { error } = await client.rpc('rate_community_post', { p_post_id: id, p_value: value });
  if (error) return { error: 'Could not save your vote. The publication may have been withdrawn. Refresh and try again.' };
  revalidatePath('/community', 'layout');
  return { success: value === 0 ? 'Your vote was removed.' : 'Your vote was saved.' };
}
