export const copilotIntents = ['question','revision','flight_search','hotel_search','reservation','expense','clarification'] as const;
export type CopilotIntent = typeof copilotIntents[number];
export type CopilotReply = {intent:CopilotIntent;reply:string;scope:'day'|'trip';day:number|null;instruction:string};
export function parseCopilotReply(text:string):CopilotReply {
 const r=JSON.parse(text);
 if(!r||!copilotIntents.includes(r.intent)||typeof r.reply!=='string'||!r.reply.trim()||r.reply.length>4000||!['day','trip'].includes(r.scope)||typeof r.instruction!=='string'||r.instruction.length>2000||!(r.day===null||Number.isInteger(r.day)&&r.day>=1&&r.day<=30))throw Error('The assistant returned an invalid response. Please try again.');
 if(r.intent==='revision'&&(!r.instruction.trim()||r.scope==='day'&&r.day===null))throw Error('The revision scope needs clarification.');
 return {intent:r.intent,reply:r.reply,scope:r.scope,day:r.day,instruction:r.instruction};
}
export type ChatMessage={id:string;author_id:string;content:string;version_id:string|null;created_at:string;response:CopilotReply|null};
