import {createScopedProposal,type ProposalInput} from '@/lib/itinerary-proposal-service';
import {collaborationAccess,collaborationBody,collaborationJson as json} from '@/lib/collaboration-route';
import {uuid} from '@/lib/collaboration';
import {loadProposals} from '@/lib/itinerary-editing-server';
import {publicationConflict,type ProposalScope} from '@/lib/itinerary-editing';
export const runtime='nodejs';
export const maxDuration=300;
export async function POST(request: Request,{params}:{params:Promise<{tripId:string}>}) {
  try {
    const {tripId}=await params;
    const access=await collaborationAccess(request,tripId);
    if(access instanceof Response) return access;
    let input: ProposalInput;
    try {
      const body=await collaborationBody(request) as Record<string,unknown>;
      if(!body || !['activity','day','trip'].includes(String(body.scope)) || typeof body.instruction!=='string' || !body.instruction.trim() || body.instruction.length>2000) throw new Error('Choose a scope and describe your request (up to 2,000 characters).');
      const scope=body.scope as ProposalScope;
      const day=scope==='trip'?null:Number(body.day);
      if(scope!=='trip' && (!Number.isInteger(day) || day!<1 || day!>30)) throw new Error('Choose a valid day.');
      input={base:uuid(body.base_version_id),scope,day,itemId:scope==='activity'?uuid(body.item_id):null,instruction:body.instruction.trim(),chatMessageId:body.chat_message_id?uuid(body.chat_message_id):null};
    } catch(e) {return json({error:e instanceof Error?e.message:'Invalid request.'},400);}
    return await createScopedProposal(access,tripId,input);
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
