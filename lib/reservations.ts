export type Reservation={id:string;kind:'flight'|'hotel';status:'planned'|'saved_option'|'booked'|'canceled';details:Record<string,string>;created_by:string};
const flightFields=['airline','flight_number','departure_airport','arrival_airport','departure_local','arrival_local','departure_timezone','arrival_timezone','notes'];
const hotelFields=['name','address','checkin_local','checkout_local','timezone','notes'];
export function parseReservation(raw:unknown){
 const b=raw as Record<string,unknown>;
 if(!b||!['flight','hotel'].includes(String(b.kind))||!['planned','saved_option','booked','canceled'].includes(String(b.status))||!b.details||typeof b.details!=='object')throw Error('Choose a reservation type and status.');
 const source=b.details as Record<string,unknown>,details:Record<string,string>={};
 for(const k of b.kind==='flight'?flightFields:hotelFields){const v=source[k]??'';if(typeof v!=='string'||v.length>1000)throw Error('Reservation fields must be up to 1,000 characters.');details[k]=v.trim();}
 for(const k of b.kind==='flight'?['departure_airport','arrival_airport','departure_local','arrival_local','departure_timezone','arrival_timezone']:['name','address','checkin_local','checkout_local','timezone'])if(!details[k])throw Error(`Add ${k.replaceAll('_',' ')}.`);
 for(const [k,v] of Object.entries(details)){
  if(k.endsWith('local')&&v&&(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'Z'))||new Date(v+'Z').toISOString().slice(0,16)!==v))throw Error('Use valid local dates and times.');
  if(k.includes('timezone')&&v){try{new Intl.DateTimeFormat('en',{timeZone:v});}catch{throw Error('Use an IANA time zone, such as Europe/Paris.');}}
 }
 if(b.kind==='hotel'&&details.checkout_local<=details.checkin_local)throw Error('Check-out must follow check-in.');
 return {kind:b.kind as Reservation['kind'],status:b.status as Reservation['status'],details};
}
