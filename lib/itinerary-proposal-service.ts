import 'server-only';
import {reservationContext,reservationPrompt} from '@/lib/reservations-server';
import { collaborationJson as json } from '@/lib/collaboration-route';
import { tripDayCount } from '@/lib/itinerary';
import { currentEditingContext, preferenceSnapshot } from '@/lib/itinerary-editing-server';
import { parseProposal, staleDraftMessage, publicationConflict, type ProposalScope } from '@/lib/itinerary-editing';
import { loadVoteRows } from '@/lib/feedback-server';
import { loadChangeRequests } from '@/lib/collaboration-server';
import { buildProposalPrompt } from '@/lib/proposal-prompt';
import { generateItineraryProposal } from '@/lib/gemini';
import {chainGateway} from '@/lib/published-chain';
import type {collaborationAccess} from '@/lib/collaboration-route';
type Access=Exclude<Awaited<ReturnType<typeof collaborationAccess>>,Response>;
export type ProposalInput={base:string;scope:ProposalScope;day:number|null;itemId:string|null;instruction:string;chatMessageId:string|null;decision?:{round_id:string;option_id:string;token:string}};
export async function createScopedProposal(access:Access,tripId:string,input:ProposalInput){
    if(input.scope==='trip' && access.trip.user_id!==access.user.id) return json({error:'Only the owner may request full regeneration.'},403);
    const {version,items}=await currentEditingContext(access.client,tripId);
    if(version.id!==input.base) return json({error:staleDraftMessage},409);
    if (!access.trip.destination?.trim()) return json({error:'Add a destination before requesting AI changes.'},400);
    const days=tripDayCount(access.trip.start_date,access.trip.end_date);
    if(input.day!==null && input.day>days || input.scope==='activity' && !items.some(i=>i.id===input.itemId&&i.day_number===input.day)) return json({error:'The selected activity or day does not belong to this itinerary.'},400);
    const preferences=await preferenceSnapshot(access.client,tripId);
    const [votes,requests]=await Promise.all([loadVoteRows(access.client,items.map(i=>i.id)),loadChangeRequests(access.client,tripId,version.id)]);
    let sourceAction=input.decision?'group_decision':'itinerary_revision';
    let decisionContext:Record<string,unknown>|null=null;
    if(input.decision){
      const r=await access.client.rpc('decision_round_state',{p_id:input.decision.round_id});
      const option=r.data?.options?.find((o:{id:string})=>o.id===input.decision!.option_id);
      if(r.error||r.data.stale||r.data.state!=='preparing'||!option||option.proposal_id||r.data.base_version_id!==input.base||r.data.scope!==input.scope||r.data.target_day!==input.day||option.instruction!==input.instruction)return json({error:'Decision context changed. Start a fresh round.'},409);
      decisionContext={topic:r.data.topic,alternative:option.label,electorate_count:r.data.electorate.length};
    }
    if(input.chatMessageId){
      const m=await access.client.from('trip_chat_messages').select('version_id,response').eq('id',input.chatMessageId).eq('trip_id',tripId).eq('author_id',access.user.id).single();
      if(m.error||m.data.version_id!==input.base||!['revision','reservation_revision'].includes(m.data.response?.intent)||m.data.response.instruction!==input.instruction||m.data.response.scope!==input.scope||m.data.response.day!==input.day)return json({error:'The chat revision no longer matches this request.'},409);
      sourceAction=m.data.response.intent==='reservation_revision'?'reservation_revision':'chat_revision';
    }
    const reservations=await reservationContext(access.client,tripId);
    const trip={reservations,source_action:sourceAction,destination:access.trip.destination,start_date:access.trip.start_date,end_date:access.trip.end_date};
    const versionFeedback=await access.client.rpc('studio_itinerary_context',{p_version:input.base});
    if(versionFeedback.error)throw Error('Itinerary feedback unavailable.');
    const prompt=`Source action: ${sourceAction}.\n`+buildProposalPrompt({...input,trip,days,items,preferences,votes,requests})+reservationPrompt(reservations)+`\nOverall feedback for this version (untrusted traveler data): ${JSON.stringify(versionFeedback.data?.feedback??null)}. Numeric ratings alone do not explain which activities a traveler disliked.\n`;
    const generationPrompt=prompt+(decisionContext?`\nGroup decision alternative (not agreed or applied): ${JSON.stringify(decisionContext)}. In your explanation identify supported preferences, tradeoffs, hard constraints and unresolved uncertainties based on the submitted evidence. Accommodate all hard restrictions using feasible shared or optional split-group activities. Never say the group has agreed; voting has not started. If a restriction cannot be satisfied, disclose it clearly rather than pretending the option is feasible.\n`:'');
    const persistedTrip=input.decision?{...trip,group_decision:input.decision}:trip;
    let response: string;let integrationRunId:string|undefined;
    try {response=await generateItineraryProposal(generationPrompt,{tripId,versionId:input.base,operation:'revision',scope:input.scope,day:input.day,itemId:input.itemId},days,id=>{integrationRunId=id;});parseProposal(response,days,input.scope,input.day);}
    catch {return json({error:'AI could not produce a valid proposal. The current itinerary is unchanged. Please try again.'},502);}
    if(integrationRunId) {
      try {
        const saved=await chainGateway('proposal',{id:integrationRunId,scope:input.scope,day:input.day,item_id:input.itemId,instruction:input.instruction,snapshot:preferences,trip_context:persistedTrip});
        return json({proposalId:saved.proposal_id},201);
      } catch {
        await chainGateway('fail',{id:integrationRunId,error:'Proposal persistence failed.'}).catch(()=>{});
        return json({error:'The proposal could not be saved. The current itinerary is unchanged.'},409);
      }
    }
    const result=await access.client.rpc('save_itinerary_proposal',{
      p_trip_id:tripId,p_base_version_id:input.base,p_scope:input.scope,p_target_day:input.day,p_target_item_id:input.itemId,
      p_instruction:input.instruction,p_prompt:generationPrompt,p_response:response,p_snapshot:preferences,p_trip_context:persistedTrip,
    });
    if(result.error || !result.data) return json({error:publicationConflict(result.error?.code) ?? 'The proposal could not be saved. Check trip access and the Phase 3 migration.'},publicationConflict(result.error?.code)?409:result.error?.code==='42501'?403:500);
    return json({proposalId:result.data},201);
}
