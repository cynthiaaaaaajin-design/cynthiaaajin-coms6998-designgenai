import { collaborationAccess, collaborationBody, collaborationJson as json } from '@/lib/collaboration-route';
import { parseTravelPreferences } from '@/lib/collaboration';
import { loadPreferences } from '@/lib/collaboration-server';
type Context = { params: Promise<{ tripId: string }> };
export async function GET(request: Request, { params }: Context) {
  try {
    const { tripId } = await params;
    const access = await collaborationAccess(request, tripId);
    if (access instanceof Response) return access;
    return json(await loadPreferences(access.client, tripId));
  } catch { return json({ error: 'Preferences could not be loaded. Please refresh.' }, 500); }
}
export async function PUT(request: Request, { params }: Context) {
  try {
    const { tripId } = await params;
    const access = await collaborationAccess(request, tripId);
    if (access instanceof Response) return access;
    let preferences;
    try { preferences = parseTravelPreferences(await collaborationBody(request)); }
    catch (e) { return json({ error: e instanceof Error ? e.message : 'Invalid preferences.' }, 400); }
    const result = await access.client.from('trip_preferences').upsert({ ...preferences, trip_id: tripId, user_id: access.user.id }, { onConflict: 'trip_id,user_id' }).select('user_id').single();
    if (result.error || !result.data) return json({ error: 'Preferences could not be saved. Check trip access and the collaboration migration.' }, result.error?.code === '42501' ? 403 : 500);
    return json({ saved: true });
  } catch { return json({ error: 'Preferences could not be saved. Please try again.' }, 500); }
}
