import {createClient} from '@/lib/supabase/server';
import {ItineraryFeedback} from './itinerary-feedback';
export async function ItineraryProvenance({tripId,versionId}:{tripId:string;versionId:string}) {
  const client=await createClient();
  const {data,error}=await client.rpc('studio_itinerary_context',{p_version:versionId});
  if(error)return <p className="mt-3 text-sm text-slate-500">Workflow attribution and overall ratings are currently unavailable.</p>;
  const generation=data?.generation;
  return <><p className="mt-3 text-sm text-slate-500">{generation?`${generation.chain_name} · Published v${generation.version_number}`:'Legacy or unlinked generation · no published workflow attribution'}</p><ItineraryFeedback key={versionId} tripId={tripId} versionId={versionId} initial={data?.feedback}/></>;
}
