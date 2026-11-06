import { activityTopics, type PreferenceRow } from './collaboration';
export type Evidence = { user_id: string; field: string; quote: string };
export type DecisionTopic = { key: string; kind: 'hard'|'difference'|'question'; title: string; detail: string; evidence: Evidence[]; source: 'rules'|'ai'|'member' };
export type DecisionRule = 'unanimous'|'majority';
export type DecisionOption = { id: string; label: string; instruction: string; proposal_id: string|null; response_text: string|null; generation_error: string|null; generated_at: string|null;constraints_confirmed_by:string|null;constraints_confirmed_at:string|null };
export type DecisionRound = { id:string;trip_id:number|string;title:string;topic:DecisionTopic;base_version_id:string;scope:'day'|'trip';target_day:number|null;rule:DecisionRule;deadline:string|null;state:'preparing'|'voting'|'canceled'|'applied';electorate:string[];preference_snapshot:{participants:string[];preferences:PreferenceRow[]};trip_context:Record<string,unknown>;created_by:string;created_at:string;applied_version_id:string|null;options:DecisionOption[];votes:{user_id:string;option_id:string;updated_at:string}[];stale:boolean;winner_id:string|null;threshold:number;votes_received:number;decision_met:boolean;counts:Record<string,number>;expired:boolean;decision_snapshot?:Record<string,unknown>|null };
export function detectPreferenceTopics(rows:PreferenceRow[],trip?:{start_date:string|null;end_date:string|null}):DecisionTopic[]{
 const topics:DecisionTopic[]=[];
 for(const [key,title] of Object.entries(activityTopics)){
  const must=rows.filter(r=>r.activity_choices?.[key as keyof typeof activityTopics]==='must'),avoid=rows.filter(r=>r.activity_choices?.[key as keyof typeof activityTopics]==='avoid');
  if(must.length&&avoid.length)topics.push({key:`activity:${key}`,kind:'hard',title:`${title}: must have / cannot accept`,detail:'Members have explicitly selected incompatible shared activity priorities. A split-group plan or a different activity needs review; a majority vote cannot make a hard restriction disappear.',source:'rules',evidence:[...must,...avoid].map(r=>({user_id:r.user_id,field:`activity_choices.${key}`,quote:r.activity_choices![key as keyof typeof activityTopics]!}))});
 }
 const budgets=new Map<string,PreferenceRow[]>();
 for(const row of rows)if(row.budget_amount!==null){const key=`${row.budget_currency}:${row.budget_scope}`;budgets.set(key,[...(budgets.get(key)??[]),row]);}
 for(const [key,people] of budgets){if(new Set(people.map(p=>p.budget_amount)).size>1)topics.push({key:`budget:${key}`,kind:'difference',title:'Different budget limits',detail:'Comparable budget limits differ. This does not prove the itinerary is unaffordable: a plan within the lower limit may satisfy everyone. No exchange rate or average is assumed.',source:'rules',evidence:people.map(p=>({user_id:p.user_id,field:'budget_amount',quote:`${p.budget_currency} ${p.budget_amount} ${p.budget_scope}`}))});}
 if(rows.some(r=>r.travel_pace==='packed')&&rows.some(r=>r.travel_pace==='relaxed'))topics.push({key:'pace',kind:'difference',title:'Relaxed and packed travel paces',detail:'This is a preference difference, not an automatic hard conflict. Discuss optional activities, rest time or split-group time.',source:'rules',evidence:rows.filter(r=>r.travel_pace!=='balanced').map(r=>({user_id:r.user_id,field:'travel_pace',quote:r.travel_pace}))});
 const available=rows.filter(r=>r.availability_start&&r.availability_end);
 if(available.length>1){const first=available.map(r=>r.availability_start!).sort().at(-1)!,last=available.map(r=>r.availability_end!).sort()[0];if(first>last)topics.push({key:'availability:overlap',kind:'hard',title:'No common availability window',detail:'The explicitly submitted date windows have no overlap. The group must review trip dates or participation; an itinerary revision alone cannot resolve this.',source:'rules',evidence:available.map(r=>({user_id:r.user_id,field:'availability',quote:`${r.availability_start} through ${r.availability_end}`}))});}
 if(trip?.start_date&&trip.end_date){const outside=available.filter(r=>r.availability_start!>trip.start_date!||r.availability_end!<trip.end_date!);if(outside.length)topics.push({key:'availability:trip',kind:'hard',title:'Availability does not cover the trip',detail:`The trip is ${trip.start_date} through ${trip.end_date}. These members submitted narrower availability. Confirm dates before treating a plan as feasible.`,source:'rules',evidence:outside.map(r=>({user_id:r.user_id,field:'availability',quote:`${r.availability_start} through ${r.availability_end}`}))});}
 return topics;
}
export function tallyDecision(electorate:string[],options:string[],votes:{user_id:string;option_id:string}[],rule:DecisionRule){
 const eligible=[...new Set(electorate)],counts=Object.fromEntries(options.map(id=>[id,0]));const latest=new Map<string,string>();
 for(const vote of votes)if(eligible.includes(vote.user_id)&&options.includes(vote.option_id))latest.set(vote.user_id,vote.option_id);
 for(const option of latest.values())counts[option]++;
 const threshold=rule==='unanimous'?eligible.length:Math.floor(eligible.length/2)+1;
 const winners=Object.keys(counts).filter(id=>threshold>0&&counts[id]>=threshold);
 return {counts,threshold,votes_received:latest.size,winner_id:winners.length===1?winners[0]:null,decision_met:winners.length===1};
}
const interpretationFields=['must_visit_places','interests','hard_constraints','additional_notes','budget_notes','dietary_restrictions','preferred_transportation'];
export function validateInterpretedTopics(input:unknown,rows:PreferenceRow[]):DecisionTopic[]{
 if(!Array.isArray(input)||input.length>6)throw Error('Invalid discussion topics.');
 return input.map((raw,index)=>{
  if(!raw||typeof raw!=='object'||!['hard','difference'].includes(raw.kind)||typeof raw.title!=='string'||raw.title.length>160||!raw.title.trim()||typeof raw.detail!=='string'||raw.detail.length>1500||!raw.detail.trim()||!Array.isArray(raw.evidence)||raw.evidence.length<2||raw.evidence.length>10)throw Error('Invalid discussion evidence.');
  const evidence:Evidence[]=raw.evidence.map((e:Evidence)=>{const row=rows.find(r=>r.user_id===e.user_id);if(!row||!interpretationFields.includes(e.field)||typeof e.quote!=='string'||!e.quote.trim()||e.quote.length>300)throw Error('AI evidence must reference submitted preferences.');const field=row[e.field as keyof PreferenceRow];const values=Array.isArray(field)?field:typeof field==='string'?[field]:[];if(!values.some(v=>typeof v==='string'&&v.includes(e.quote)))throw Error('AI quoted text was not found in saved preferences.');return {user_id:e.user_id,field:e.field,quote:e.quote};});
  if(new Set(evidence.map(e=>e.user_id)).size<2)throw Error('A group disagreement needs evidence from distinct members.');
  if(raw.kind==='hard'&&!evidence.some(e=>['hard_constraints','dietary_restrictions'].includes(e.field)))throw Error('Hard-conflict suggestions need explicit restriction evidence.');
  return {key:`ai:${index}`,kind:raw.kind,title:raw.title,detail:raw.detail,evidence,source:'ai'};
 });
}
