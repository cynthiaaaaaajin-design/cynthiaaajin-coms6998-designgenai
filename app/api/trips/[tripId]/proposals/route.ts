import {reservationContext,reservationPrompt} from '@/lib/reservations-server';
import { collaborationAccess, collaborationBody, collaborationJson as json } from '@/lib/collaboration-route';
import { uuid } from '@/lib/collaboration';
import { tripDayCount } from '@/lib/itinerary';
import { currentEditingContext, preferenceSnapshot, loadProposals } from '@/lib/itinerary-editing-server';
import { parseProposal, staleDraftMessage, publicationConflict, type ProposalScope } from '@/lib/itinerary-editing';
import { loadVoteRows } from '@/lib/feedback-server';
import { loadChangeRequests } from '@/lib/collaboration-server';
import { buildProposalPrompt } from '@/lib/proposal-prompt';
import { generateItineraryProposal } from '@/lib/gemini';
import {chainGateway} from '@/lib/published-chain';
export const runtime='nodejs';
export const maxDuration=300;
export async function POST(request: Request,{params}:{params:Promise<{tripId:string}>}) {
  try {
    const {tripId}=await params;
    const access=await collaborationAccess(request,tripId);
    if(access instanceof Response) return access;
    let input: {base: string;scope:ProposalScope;day:number|null;itemId:string|null;instruction:string;chatMessageId:string|null};
    try {
      const body=await collaborationBody(request) as Record<string,unknown>;
      if(!body || !['activity','day','trip'].includes(String(body.scope)) || typeof body.instruction!=='string' || !body.instruction.trim() || body.instruction.length>2000) throw new Error('Choose a scope and describe your request (up to 2,000 characters).');
      const scope=body.scope as ProposalScope;
      const day=scope==='trip'?null:Number(body.day);
      if(scope!=='trip' && (!Number.isInteger(day) || day!<1 || day!>30)) throw new Error('Choose a valid day.');
      input={base:uuid(body.base_version_id),scope,day,itemId:scope==='activity'?uuid(body.item_id):null,instruction:body.instruction.trim(),chatMessageId:body.chat_message_id?uuid(body.chat_message_id):null};
    } catch(e) {return json({error:e instanceof Error?e.message:'Invalid request.'},400);}
    if(input.scope==='trip' && access.trip.user_id!==access.user.id) return json({error:'Only the owner may request full regeneration.'},403);
    const {version,items}=await currentEditingContext(access.client,tripId);
    if(version.id!==input.base) return json({error:staleDraftMessage},409);
    if (!access.trip.destination?.trim()) return json({error:'Add a destination before requesting AI changes.'},400);
    const days=tripDayCount(access.trip.start_date,access.trip.end_date);
    if(input.day!==null && input.day>days || input.scope==='activity' && !items.some(i=>i.id===input.itemId&&i.day_number===input.day)) return json({error:'The selected activity or day does not belong to this itinerary.'},400);
    const preferences=await preferenceSnapshot(access.client,tripId);
    const [votes,requests]=await Promise.all([loadVoteRows(access.client,items.map(i=>i.id)),loadChangeRequests(access.client,tripId,version.id)]);
    let sourceAction='itinerary_revision';
    if(input.chatMessageId){
      const m=await access.client.from('trip_chat_messages').select('version_id,response').eq('id',input.chatMessageId).eq('trip_id',tripId).eq('author_id',access.user.id).single();
      if(m.error||m.data.version_id!==input.base||!['revision','reservation_revision'].includes(m.data.response?.intent)||m.data.response.instruction!==input.instruction||m.data.response.scope!==input.scope||m.data.response.day!==input.day)return json({error:'The chat revision no longer matches this request.'},409);
      sourceAction=m.data.response.intent==='reservation_revision'?'reservation_revision':'chat_revision';
    }
    const reservations=await reservationContext(access.client,tripId);
    const trip={reservations,source_action:sourceAction,destination:access.trip.destination,start_date:access.trip.start_date,end_date:access.trip.end_date};
    const prompt=`Source action: ${sourceAction}.\n`+buildProposalPrompt({...input,trip,days,items,preferences,votes,requests})+reservationPrompt(reservations);
    let response: string;let integrationRunId:string|undefined;
    try {response=await generateItineraryProposal(prompt,{tripId,versionId:input.base,operation:'revision',scope:input.scope,day:input.day,itemId:input.itemId},days,id=>{integrationRunId=id;});parseProposal(response,days,input.scope,input.day);}
    catch {return json({error:'AI could not produce a valid proposal. The current itinerary is unchanged. Please try again.'},502);}
    if(integrationRunId) {
      try {
        const saved=await chainGateway('proposal',{id:integrationRunId,scope:input.scope,day:input.day,item_id:input.itemId,instruction:input.instruction,snapshot:preferences,trip_context:trip});
        return json({proposalId:saved.proposal_id},201);
      } catch {
        await chainGateway('fail',{id:integrationRunId,error:'Proposal persistence failed.'}).catch(()=>{});
        return json({error:'The proposal could not be saved. The current itinerary is unchanged.'},409);
      }
    }
    const result=await access.client.rpc('save_itinerary_proposal',{
      p_trip_id:tripId,p_base_version_id:input.base,p_scope:input.scope,p_target_day:input.day,p_target_item_id:input.itemId,
      p_instruction:input.instruction,p_prompt:prompt,p_response:response,p_snapshot:preferences,p_trip_context:trip,
    });
    if(result.error || !result.data) return json({error:publicationConflict(result.error?.code) ?? 'The proposal could not be saved. Check trip access and the Phase 3 migration.'},publicationConflict(result.error?.code)?409:result.error?.code==='42501'?403:500);
    return json({proposalId:result.data},201);
  } catch {return json({error:'AI context could not be loaded. Check access and the Phase 3 migration. Your published itinerary is unchanged.'},500);}
}
export async function PATCH(request: Request,{params}:{params:Promise<{tripId:string}>}) {
  try {
    const {tripId}=await params;
    const access=await collaborationAccess(request,tripId);
    if(access instanceof Response) return access;
    if(access.trip.user_id!==access.user.id) return json({error:'Only the owner can apply AI proposals.'},403);
    let id:string;
    try {const body=await collaborationBody(request) as Record<string,unknown>;id=uuid(body?.proposal_id);} catch {return json({error:'Invalid proposal.'},400);}
    const result=await access.client.rpc('apply_itinerary_proposal',{p_trip_id:tripId,p_proposal_id:id});
    if(result.error || !result.data) return json({error:publicationConflict(result.error?.code) ?? 'The proposal could not be applied. The current itinerary is unchanged.'},publicationConflict(result.error?.code)?409:result.error?.code==='42501'?403:500);
    return json({versionId:result.data},201);
  } catch {return json({error:'Changes could not be applied. The current itinerary is unchanged.'},500);}
}

export async function GET(request:Request,{params}:{params:Promise<{tripId:string}>}){
 try{const {tripId}=await params;const a=await collaborationAccess(request,tripId);if(a instanceof Response)return a;
 const base=uuid(new URL(request.url).searchParams.get('base'));
 const v=await a.client.from('itinerary_versions').select('id').eq('id',base).eq('trip_id',tripId).maybeSingle();
 if(v.error||!v.data)return json({error:'Version unavailable.'},404);
 return json({proposals:await loadProposals(a.client,tripId,base)});
 }catch{return json({error:'Proposals unavailable.'},500);}
}
