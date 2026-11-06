export const copilotIntents = ['question','revision','reservation_revision','flight_search','hotel_search','reservation','expense','clarification'] as const;
export type CopilotIntent = typeof copilotIntents[number];
export type ReservationDraft={kind:'flight'|'hotel';details:Record<string,string>};
export type CopilotReply = {intent:CopilotIntent;reply:string;scope:'day'|'trip';day:number|null;instruction:string;reservation_draft?:ReservationDraft|null};
export function parseCopilotReply(text:string):CopilotReply {
 const r=JSON.parse(text);
 if(!r||!copilotIntents.includes(r.intent)||typeof r.reply!=='string'||!r.reply.trim()||r.reply.length>4000||!['day','trip'].includes(r.scope)||typeof r.instruction!=='string'||r.instruction.length>2000||!(r.day===null||Number.isInteger(r.day)&&r.day>=1&&r.day<=30))throw Error('The assistant returned an invalid response. Please try again.');
 if(['revision','reservation_revision'].includes(r.intent)&&(!r.instruction.trim()||r.scope==='day'&&r.day===null))throw Error('The revision scope needs clarification.');
 const draft=r.reservation_draft;
 if(draft!=null){if(!['flight','hotel'].includes(draft.kind)||!draft.details||typeof draft.details!=='object'||Array.isArray(draft.details)||Object.entries(draft.details).some(([k,v])=>!['airline','flight_number','departure_airport','arrival_airport','departure_local','arrival_local','departure_timezone','arrival_timezone','notes','name','address','checkin_local','checkout_local','timezone'].includes(k)||typeof v!=='string'||v.length>1000))throw Error('Invalid reservation draft.');}
 return {reservation_draft:draft??null,intent:r.intent,reply:r.reply,scope:r.scope,day:r.day,instruction:r.instruction};
}
export type ChatMessage={id:string;author_id:string;content:string;version_id:string|null;created_at:string;response:CopilotReply|null};
