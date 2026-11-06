// External navigation adapter. No inventory API is configured, and no supplier request is made.
export type TravelQuery={kind:'flight'|'hotel';destination:string;origin?:string;start:string;end?:string;guests:number;rooms?:number;cabin?:string;preference?:string};
export type Discovery={mode:'external_link';provider:string;url:string;query_timestamp:string;availability:'not_checked';limitation:string};
export interface TravelDiscoveryProvider {search(query:TravelQuery):Discovery}
export const externalTravelSearch:TravelDiscoveryProvider={search(q){
 const query=q.kind==='flight'?`Flights from ${q.origin||''} to ${q.destination} departing ${q.start} ${q.end?`returning ${q.end}`:'one way'} ${q.guests} passengers ${q.cabin||''}`:`Hotels in ${q.destination} check in ${q.start} check out ${q.end||''} ${q.guests} guests ${q.rooms||1} rooms ${q.preference||''}`;
 return {mode:'external_link',provider:'Google Travel',url:`https://www.google.com/travel/${q.kind==='flight'?'flights':'hotels'}?q=${encodeURIComponent(query)}`,query_timestamp:new Date().toISOString(),availability:'not_checked',limitation:'External search only. TripSync has not checked prices or availability. Confirm all search fields on the provider website.'};
}};
