import {createClient} from '@/lib/supabase/server';
import {ItineraryFeedback} from './itinerary-feedback';
export async function ItineraryProvenance({tripId,versionId,versionNumber}:{tripId:string;versionId:string;versionNumber?:number}) {
  const client=await createClient();
  const {data,error}=await client.rpc('studio_itinerary_context',{p_version:versionId});
  if(error)return <p className="mt-3 text-sm text-slate-500">Workflow attribution and overall ratings are currently unavailable.</p>;
  const generation=data?.generation;
  const routing=generation?.routing_decision;
  const {data:admin}=await client.rpc('is_superadmin');
  return <>{routing?.fallback&&<p className="mt-3 text-sm text-slate-500">This plan used the global workflow ({String(routing.fallback_reason||'no regional match').replaceAll('_',' ')}).</p>}{admin===true&&<details className="itinerary-attribution"><summary>Generation details</summary><p>{generation?`${generation.chain_name} · Published v${generation.version_number}`:'Legacy or unlinked generation · no published workflow attribution'}</p>{routing&&<p>{routing.country_code||'Unresolved country'} · {routing.selected_rule}</p>}</details>}<ItineraryFeedback key={versionId} tripId={tripId} versionId={versionId} versionNumber={versionNumber} initial={data?.feedback}/></>;
}
