import 'server-only';
import { loadTripPeople, personName } from './trip-people';
import type { createClient } from '@/lib/supabase/server';
import type { Traveler } from '@/lib/travelers';

type Client = Awaited<ReturnType<typeof createClient>>;
type ProfileLabel = { first_name: string | null; last_name: string | null };

export async function loadTravelers(supabase: Client, tripId: string): Promise<Traveler[]> {
  const people = await loadTripPeople(supabase, tripId);
  const travelers: Traveler[] = [];
  let cursor: string | undefined;
  while (true) {
    // A left embed preserves membership rows even if profile RLS hides the label.
    let query = supabase.from('trip_members')
      .select('user_id,profile:profiles(first_name,last_name)')
      .eq('trip_id', tripId).order('user_id').limit(200);
    if (cursor) query = query.gt('user_id', cursor);
    const { data, error } = await query;
    if (error) throw new Error('Travelers could not be loaded. Please refresh to try again.');
    if (!data?.length) break;
    for (const member of data) {
      const profile = (Array.isArray(member.profile) ? member.profile[0] : member.profile) as ProfileLabel | null;
      travelers.push({
        userId: member.user_id,
        name: [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim() || null,
        email: null,
      });
    }
    cursor = data[data.length - 1].user_id;
  }
  return travelers.map(traveler => {
    const person = people?.find(person => person.user_id === traveler.userId);
    return person ? { ...traveler, name: personName(person), email: person.email } : traveler;
  }).concat((people ?? []).filter(person => person.is_owner).map(person => ({ userId: person.user_id, name: personName(person), email: person.email })));
}

export async function loadPrivateTrips(supabase: Client, userId: string) {
  const sharedIds = new Set<string>();
  let memberCursor: string | undefined;
  while (true) {
    let query = supabase.from('trip_members').select('trip_id::text')
      .eq('user_id', userId).order('trip_id').limit(200);
    if (memberCursor) query = query.gt('trip_id', memberCursor);
    const { data, error } = await query;
    if (error) throw new Error('Your shared trips could not be checked. Please refresh to try again.');
    if (!data?.length) break;
    for (const row of data) sharedIds.add(row.trip_id);
    memberCursor = data[data.length - 1].trip_id;
  }
  const trips: { isOwner: boolean; ownerName: string | null; id: string; title: string | null; destination: string | null; start_date: string | null; end_date: string | null }[] = [];
  let cursor: string | undefined;
  while (true) {
    let query = supabase.from('trips').select('id::text,user_id,title,destination,start_date,end_date')
      .order('id').limit(200);
    if (cursor) query = query.gt('id', cursor);
    const { data, error } = await query;
    if (error) throw new Error('Your trips could not be loaded. Please refresh to try again.');
    if (!data?.length) break;
    for (const row of data) {
      // Defense in depth: never render a merely readable nonparticipant trip.
      if (row.user_id === userId || sharedIds.has(row.id)) {
        trips.push({ isOwner: row.user_id === userId, ownerName: null, id: row.id, title: row.title, destination: row.destination, start_date: row.start_date, end_date: row.end_date });
      }
    }
    cursor = data[data.length - 1].id;
  }
  await Promise.all(trips.filter(trip => !trip.isOwner).map(async trip => {
    const owner = (await loadTripPeople(supabase, trip.id))?.find(person => person.is_owner);
    trip.ownerName = owner ? personName(owner) : null;
  }));
  return trips.sort((a, b) => (a.start_date ?? '9999').localeCompare(b.start_date ?? '9999'));
}
