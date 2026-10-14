import { collaborationAccess, collaborationBody, collaborationJson as json } from '@/lib/collaboration-route';
import { uuid } from '@/lib/collaboration';
import { tripDayCount } from '@/lib/itinerary';
import { staleDraftMessage, validateDraft } from '@/lib/itinerary-editing';
export async function POST(request: Request,{params}:{params:Promise<{tripId:string}>}) {
  try {
    const {tripId}=await params;
    const access=await collaborationAccess(request,tripId);
    if(access instanceof Response) return access;
    let base: string; let activities;
    try {
      const body=await collaborationBody(request,600000) as Record<string,unknown>;
      base=uuid(body?.base_version_id);
      activities=validateDraft(body.activities,tripDayCount(access.trip.start_date,access.trip.end_date));
    } catch(e) {return json({error:e instanceof Error?e.message:'Invalid draft.'},400);}
    const result=await access.client.rpc('save_manual_itinerary',{p_trip_id:tripId,p_base_version_id:base,p_activities:activities});
    if(result.error) return json({error:result.error.code==='40001' || result.error.code==='23505' ? staleDraftMessage : result.error.code==='42501' ? 'Trip access is no longer available.' : 'Draft could not be saved. Check the Phase 3 migration and activity fields.'},result.error.code==='42501'?403:['40001','23505'].includes(result.error.code)?409:400);
    if(!result.data) return json({error:'Draft could not be saved.'},500);
    return json({versionId:result.data},201);
  } catch {return json({error:'Draft could not be saved. Your draft has not been published.'},500);}
}
