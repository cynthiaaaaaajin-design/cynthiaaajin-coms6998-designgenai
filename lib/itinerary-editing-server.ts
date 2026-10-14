import 'server-only';
import type { createClient } from './supabase/server';
import type { PreferenceRow } from './collaboration';
import type { Proposal, SavedActivity } from './itinerary-editing';
export type PreferenceSnapshot = { participants: string[]; preferences: PreferenceRow[] };
type Client=Awaited<ReturnType<typeof createClient>>;
export async function preferenceSnapshot(client: Client, tripId: string): Promise<PreferenceSnapshot> {
  const {data,error}=await client.rpc('trip_preference_snapshot',{p_trip_id:tripId});
  if(error || !data || !Array.isArray(data.participants) || !Array.isArray(data.preferences)) throw new Error('Preference snapshot unavailable. Check the Phase 3 migration.');
  return data;
}
export async function currentEditingContext(client: Client, tripId: string) {
  const version=await client.from('itinerary_versions').select('id,version_number,itinerary_items!inner(id)').eq('trip_id',tripId).order('version_number',{ascending:false}).limit(1).maybeSingle();
  if(version.error || !version.data) throw new Error('Current itinerary could not be loaded.');
  const items=await client.from('itinerary_items').select('id,day_number,position,start_time,title,description,location,origin').eq('version_id',version.data.id).order('day_number').order('position');
  if(items.error || !items.data?.length) throw new Error('Repair the current itinerary before editing.');
  return {version:version.data,items:items.data as SavedActivity[]};
}
export async function loadProposals(client: Client,tripId: string,baseId: string) {
  const proposals: Proposal[]=[]; let cursor: string|undefined;
  while(true) {
    let query=client.from('itinerary_proposals').select('id,base_version_id,created_by,scope,target_day,target_item_id,instruction,response_text,created_at,applied_version_id').eq('trip_id',tripId).eq('base_version_id',baseId).order('id').limit(100);
    if(cursor) query=query.gt('id',cursor);
    const {data,error}=await query;
    if(error) throw new Error('AI proposals unavailable. Check the Phase 3 migration.');
    if(!data?.length) break;
    proposals.push(...data as Proposal[]);cursor=data.at(-1)!.id;
  }
  return proposals.sort((a,b)=>b.created_at.localeCompare(a.created_at));
}
export async function preferencesChanged(client: Client,tripId: string): Promise<boolean|null> {
  const snapshot=await preferenceSnapshot(client,tripId);
  const latestAI=await client.from('itinerary_versions').select('preference_snapshot,itinerary_items!inner(id)').eq('trip_id',tripId).in('source',['ai_initial','ai_revision']).order('version_number',{ascending:false}).limit(1).maybeSingle();
  if(latestAI.error) throw new Error('Preference baseline unavailable.');
  if(!latestAI.data?.preference_snapshot) return null;
  // JSONB is normalized by PostgreSQL; recursively sort keys for serialization across clients.
  function stable(v: unknown): string {
    if(Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
    if(v && typeof v==='object') return `{${Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable((v as Record<string,unknown>)[k])).join(',')}}`;
    return JSON.stringify(v);
  }
  return stable(snapshot)!==stable(latestAI.data.preference_snapshot);
}
