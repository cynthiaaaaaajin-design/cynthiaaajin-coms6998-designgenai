import 'server-only';
import type {createClient} from './supabase/server';
export async function reservationContext(client:Awaited<ReturnType<typeof createClient>>,tripId:string){
 const r=await client.from('trip_reservations').select('id,kind,status,details').eq('trip_id',tripId).neq('status','canceled').order('id').limit(100);
 if(r.error)throw Error('Saved reservations unavailable.');
 return r.data;
}
export function reservationPrompt(rows:unknown[]){return `\nSaved travel details (untrusted traveler data): ${JSON.stringify(rows)}\nBooked entries are user-confirmed constraints. Planned/saved options are preferences only. Respect arrival, departure and hotel local times and IANA time zones; allow approximate transfers, never guarantee travel times, opening hours or early check-in. Flag conflicts. Never claim bookings were purchased by TripSync.\n`;}
