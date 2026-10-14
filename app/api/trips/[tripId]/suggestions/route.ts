import { collaborationAccess, collaborationBody, collaborationJson as json } from '@/lib/collaboration-route';
import { parseChangeRequest, uuid } from '@/lib/collaboration';
import { loadChangeRequests } from '@/lib/collaboration-server';
type Context = { params: Promise<{ tripId: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const { tripId } = await params;
    const access = await collaborationAccess(request, tripId);
    if (access instanceof Response) return access;
    let version;
    try { version = uuid(new URL(request.url).searchParams.get('version')); } catch { return json({ error: 'Invalid version.' }, 400); }
    const rows = await loadChangeRequests(access.client, tripId, version);
    return json({ requests: access.trip.user_id === access.user.id ? rows : rows.filter(row => row.created_by === access.user.id) });
  } catch { return json({ error: 'Suggestions could not be loaded.' }, 500); }
}
export async function POST(request: Request, { params }: Context) {
  try {
    const { tripId } = await params;
    const access = await collaborationAccess(request, tripId);
    if (access instanceof Response) return access;
    let input;
    try { input = parseChangeRequest(await collaborationBody(request)); } catch (e) { return json({ error: e instanceof Error ? e.message : 'Invalid suggestion.' }, 400); }
    const version = await access.client.from('itinerary_versions').select('id,itinerary_items!inner(id)').eq('trip_id', tripId).order('version_number', { ascending: false }).limit(1).maybeSingle();
    if (version.error) return json({ error: 'Could not check the current version.' }, 500);
    if (!version.data || version.data.id !== input.version_id) return json({ error: 'This is no longer the current itinerary. Refresh before suggesting a change.' }, 409);
    const item = await access.client.from('itinerary_items').select('id').eq('id', input.item_id).eq('version_id', input.version_id).maybeSingle();
    if (item.error) return json({ error: 'Could not check the activity.' }, 500);
    if (!item.data) return json({ error: 'Activity does not belong to this itinerary.' }, 409);
    const result = await access.client.from('activity_change_requests').insert({ ...input, trip_id: tripId, created_by: access.user.id }).select('id').single();
    if (result.error || !result.data) return json({ error: 'Suggestion could not be saved. Refresh and check trip access.' }, result.error?.code === '42501' ? 403 : 409);
    return json({ saved: true, id: result.data.id }, 201);
  } catch { return json({ error: 'Suggestion could not be saved. Please try again.' }, 500); }
}
export async function PATCH(request: Request, { params }: Context) {
  try {
    const { tripId } = await params;
    const access = await collaborationAccess(request, tripId);
    if (access instanceof Response) return access;
    if (access.trip.user_id !== access.user.id) return json({ error: 'Only the trip owner can review suggestions.' }, 403);
    let id: string; let status: 'resolved' | 'declined';
    try {
      const input = await collaborationBody(request) as Record<string, unknown>;
      id = uuid(input?.id);
      if (input.status !== 'resolved' && input.status !== 'declined') throw new Error('Choose resolved or declined.');
      status = input.status;
    } catch { return json({ error: 'Invalid suggestion status.' }, 400); }
    const result = await access.client.from('activity_change_requests').update({ status }).eq('trip_id', tripId).eq('id', id).eq('status', 'pending').select('id').maybeSingle();
    if (result.error) return json({ error: 'Suggestion could not be updated.' }, 500);
    if (!result.data) return json({ error: 'Suggestion is unavailable or has already been reviewed. Refresh to see its status.' }, 409);
    return json({ saved: true });
  } catch { return json({ error: 'Suggestion could not be updated. Please try again.' }, 500); }
}
