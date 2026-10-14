import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import type { ChangeRequest, Person, PreferenceRow } from './collaboration';
type Client = Awaited<ReturnType<typeof createClient>>;
export async function loadPreferences(client: Client, tripId: string) {
  const people: Person[] = [];
  // Paginate RPC results too: project row limits must not truncate participation.
  for (let offset = 0; ; ) {
    const result = await client.rpc('collaboration_people', { p_trip_id: tripId }).range(offset, offset + 199);
    if (result.error) throw new Error('Travel preferences could not be loaded. Check the collaboration migration and refresh.');
    if (!result.data?.length) break;
    people.push(...result.data); offset += result.data.length;
  }
  const rows: PreferenceRow[] = [];
  let cursor: string | undefined;
  while (true) {
    let query = client.from('trip_preferences').select('user_id,budget_amount,budget_currency,budget_scope,budget_notes,travel_pace,must_visit_places,interests,hard_constraints,additional_notes').eq('trip_id', tripId).order('user_id').limit(200);
    if (cursor) query = query.gt('user_id', cursor);
    const result = await query;
    if (result.error) throw new Error('Travel preferences could not be loaded. Check the collaboration migration and refresh.');
    if (!result.data?.length) break;
    rows.push(...result.data as PreferenceRow[]); cursor = result.data.at(-1)!.user_id;
  }
  return { people, preferences: rows.filter(row => people.some(person => person.user_id === row.user_id)) };
}
export async function loadChangeRequests(client: Client, tripId: string, versionId: string) {
  const rows: ChangeRequest[] = [];
  let cursor: string | undefined;
  while (true) {
    let query = client.from('activity_change_requests').select('id,version_id,item_id,created_by,request_type,reason,comment,suggested_replacement,status,resolved_by,resolved_at').eq('trip_id', tripId).eq('version_id', versionId).order('id').limit(200);
    if (cursor) query = query.gt('id', cursor);
    const result = await query;
    if (result.error) throw new Error('Suggestions could not be loaded. Check the collaboration migration and refresh.');
    if (!result.data?.length) break;
    rows.push(...result.data as ChangeRequest[]); cursor = result.data.at(-1)!.id;
  }
  return rows;
}
