import 'server-only';
import type { createClient } from '@/lib/supabase/server';
export type TripPerson = { trip_id: string | number; user_id: string; first_name: string | null; last_name: string | null; email: string | null; is_owner: boolean };
export async function loadTripPeople(supabase: Awaited<ReturnType<typeof createClient>>, tripId: string): Promise<TripPerson[] | null> {
  const { data, error } = await supabase.rpc('trip_participant_display', { p_trip_id: tripId });
  // Names are optional until the separately reviewed display helper is installed.
  if (error) {
    // Log diagnostics only; never log the participant response or emails.
    console.error('[Trip participant display]', {
      code: error.code,
      message: error.message,
      hint: error.code === 'PGRST202'
        ? 'Install the reviewed sql/trip-participant-display.sql function.'
        : 'Check the display RPC and its authenticated execution permission.',
    });
    return null;
  }
  if (!Array.isArray(data)) {
    console.error('[Trip participant display]', 'Expected participant rows from the display RPC.');
    return null;
  }
  return data as TripPerson[];
}
export function personName(person: Pick<TripPerson, 'first_name' | 'last_name'>) {
  return [person.first_name, person.last_name].filter(Boolean).join(' ').trim() || null;
}
