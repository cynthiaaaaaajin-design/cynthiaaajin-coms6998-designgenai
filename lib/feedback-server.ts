import 'server-only';
import { loadTripPeople, personName } from './trip-people';
import type { createClient } from '@/lib/supabase/server';
import { summarizeVotes, type VoteRow } from '@/lib/feedback';

type Client = Awaited<ReturnType<typeof createClient>>;

export async function accessibleTrip(supabase: Client, tripId: string, userId: string) {
  const { data: trip, error } = await supabase.from('trips')
    .select('user_id,title,destination,start_date,end_date').eq('id', tripId).maybeSingle();
  if (error) throw new Error('Your trip could not be loaded. Please try again.');
  if (!trip) return null;
  if (trip.user_id !== userId) {
    const membership = await supabase.from('trip_members').select('user_id')
      .eq('trip_id', tripId).eq('user_id', userId).maybeSingle();
    if (membership.error) throw new Error('Trip membership could not be checked. Please try again.');
    if (!membership.data) return null;
  }
  return trip;
}

export async function loadVoteRows(supabase: Client, itemIds: string[]): Promise<VoteRow[]> {
  if (!itemIds.length) return [];
  const rows: VoteRow[] = [];
  let cursor: string | undefined;
  // Cursor pagination avoids Supabase's row limit and shifting offset pages.
  // Select bigint IDs as text so large identity values remain exact in JavaScript.
  while (true) {
    let query = supabase.from('activity_votes').select('id::text,item_id,user_id,value,comment')
      .in('item_id', itemIds).order('id', { ascending: false }).limit(500);
    if (cursor) query = query.lt('id', cursor);
    const { data, error } = await query;
    if (error) throw new Error('Feedback could not be loaded. Please refresh to try again.');
    if (!data?.length) break;
    rows.push(...data as VoteRow[]);
    cursor = String(data[data.length - 1].id);
  }
  return rows;
}

export async function loadFeedback(supabase: Client, itemIds: string[], userId: string, tripId?: string) {
  const rows = await loadVoteRows(supabase, itemIds);
  const people = tripId ? await loadTripPeople(supabase, tripId) : null;
  const summaries = summarizeVotes(people ? rows.filter(row => people.some(person => person.user_id === row.user_id)) : rows, userId);
  for (const summary of Object.values(summaries)) {
    for (const vote of summary.group) {
      const person = people?.find(person => person.user_id === vote.userId);
      vote.name = person ? personName(person) : null;
    }
  }
  return summaries;
}
