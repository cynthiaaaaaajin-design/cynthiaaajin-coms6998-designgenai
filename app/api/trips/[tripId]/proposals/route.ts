import { collaborationAccess, collaborationBody, collaborationJson as json } from '@/lib/collaboration-route';
import { uuid } from '@/lib/collaboration';
import { tripDayCount } from '@/lib/itinerary';
import { currentEditingContext, preferenceSnapshot } from '@/lib/itinerary-editing-server';
import { parseProposal, staleDraftMessage, publicationConflict, type ProposalScope } from '@/lib/itinerary-editing';
import { loadVoteRows } from '@/lib/feedback-server';
import { loadChangeRequests } from '@/lib/collaboration-server';
import { buildProposalPrompt } from '@/lib/proposal-prompt';
import { generateItineraryProposal } from '@/lib/gemini';
export const runtime='nodejs';
export const maxDuration=120;
export async function POST(request: Request,{params}:{params:Promise<{tripId:string}>}) {
  try {
    const {tripId}=await params;
    const access=await collaborationAccess(request,tripId);
    if(access instanceof Response) return access;
    let input: {base: string;scope:ProposalScope;day:number|null;itemId:string|null;instruction:string};
    try {
      const body=await collaborationBody(request) as Record<string,unknown>;
      if(!body || !['activity','day','trip'].includes(String(body.scope)) || typeof body.instruction!=='string' || !body.instruction.trim() || body.instruction.length>2000) throw new Error('Choose a scope and describe your request (up to 2,000 characters).');
      const scope=body.scope as ProposalScope;
      const day=scope==='trip'?null:Number(body.day);
      if(scope!=='trip' && (!Number.isInteger(day) || day!<1 || day!>30)) throw new Error('Choose a valid day.');
      input={base:uuid(body.base_version_id),scope,day,itemId:scope==='activity'?uuid(body.item_id):null,instruction:body.instruction.trim()};
    } catch(e) {return json({error:e instanceof Error?e.message:'Invalid request.'},400);}
    if(input.scope==='trip' && access.trip.user_id!==access.user.id) return json({error:'Only the owner may request full regeneration.'},403);
    const {version,items}=await currentEditingContext(access.client,tripId);
    if(version.id!==input.base) return json({error:staleDraftMessage},409);
    if (!access.trip.destination?.trim()) return json({error:'Add a destination before requesting AI changes.'},400);
    const days=tripDayCount(access.trip.start_date,access.trip.end_date);
    if(input.day!==null && input.day>days || input.scope==='activity' && !items.some(i=>i.id===input.itemId&&i.day_number===input.day)) return json({error:'The selected activity or day does not belong to this itinerary.'},400);
    const preferences=await preferenceSnapshot(access.client,tripId);
    const [votes,requests]=await Promise.all([loadVoteRows(access.client,items.map(i=>i.id)),loadChangeRequests(access.client,tripId,version.id)]);
    const trip={destination:access.trip.destination,start_date:access.trip.start_date,end_date:access.trip.end_date};
    const prompt=buildProposalPrompt({...input,trip,days,items,preferences,votes,requests});
    let response: string;
    try {response=await generateItineraryProposal(prompt);parseProposal(response,days,input.scope,input.day);}
    catch {return json({error:'AI could not produce a valid proposal. The current itinerary is unchanged. Please try again.'},502);}
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
