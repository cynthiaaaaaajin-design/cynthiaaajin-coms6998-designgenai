import type { ItineraryActivity } from './itinerary';
import { uuid } from './collaboration';
export const staleDraftMessage = 'This itinerary has been updated by another traveler. Please review the latest version before applying your changes.';
export const preferenceConflictMessage = 'Group preferences or trip details have changed since this preview. Please generate a refreshed proposal before applying changes.';
export function publicationConflict(code?: string) {
  return code === 'P3001' ? preferenceConflictMessage : code === '40001' || code === '23505' ? staleDraftMessage : null;
}
export type EditableActivity = ItineraryActivity & { source_item_id: string | null };
export type SavedActivity = ItineraryActivity & { id: string; origin?: string };
export type ProposalScope = 'activity' | 'day' | 'trip';
export type ProposalBody = { activities: EditableActivity[]; explanation: string; uncertainties: string[] };
export type Proposal = {
  id: string; base_version_id: string; created_by: string; scope: ProposalScope; target_day: number | null;
  target_item_id: string | null; instruction: string; response_text: string; created_at: string; applied_version_id: string | null;
};
export function asDraft(items: SavedActivity[]): EditableActivity[] {
  return items.map(({ id, day_number, position, start_time, title, description, location }) => ({ source_item_id: id, day_number, position, start_time: start_time?.slice(0,5) ?? null, title, description, location }));
}
export function orderDraft(items: EditableActivity[]) {
  const nextPosition = new Map<number, number>();
  return [...items].sort((a,b) => a.day_number-b.day_number).map(item => {
    const position=nextPosition.get(item.day_number) ?? 0; nextPosition.set(item.day_number,position+1);
    return { ...item, position };
  });
}
export function validateDraft(input: unknown, days: number): EditableActivity[] {
  if (!Array.isArray(input) || input.length<1 || input.length>120) throw new Error('Keep between 1 and 120 activities.');
  const seen=new Set<string>(); const positions=new Map<number,number>(); let lastDay=0;
  return input.map(raw => {
    if (!raw || typeof raw!=='object' || Array.isArray(raw)) throw new Error('Invalid activity.');
    const a=raw as Record<string,unknown>;
    if (!Number.isInteger(a.day_number) || Number(a.day_number)<1 || Number(a.day_number)>days || Number(a.day_number)<lastDay || a.position!==(positions.get(Number(a.day_number)) ?? 0)) throw new Error('Activities must have valid days and consecutive positions.');
    const day_number=Number(a.day_number); lastDay=day_number; positions.set(day_number,Number(a.position)+1);
    if (typeof a.title!=='string' || !a.title.trim() || a.title.length>200) throw new Error('Activity titles need 1–200 characters.');
    if (a.start_time!==null && (typeof a.start_time!=='string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(a.start_time))) throw new Error('Use a valid HH:MM time or leave it flexible.');
    for (const key of ['description','location']) if (a[key]!==null && (typeof a[key]!=='string' || String(a[key]).length>2000)) throw new Error('Descriptions and locations must be at most 2,000 characters.');
    const source_item_id=a.source_item_id==null ? null : uuid(a.source_item_id);
    if (source_item_id && seen.has(source_item_id)) throw new Error('An activity cannot be copied twice in one draft.');
    if (source_item_id) seen.add(source_item_id);
    return { source_item_id, day_number, position:Number(a.position),start_time:a.start_time as string|null,title:a.title.trim(),description:a.description as string|null,location:a.location as string|null };
  });
}
export function parseProposal(text: string, days: number, scope: ProposalScope, day: number | null): ProposalBody {
  const body=JSON.parse(text);
  if (!body || typeof body.explanation!=='string' || !body.explanation.trim() || body.explanation.length>4000 || !Array.isArray(body.uncertainties) || body.uncertainties.length>20 || body.uncertainties.some((s: unknown) => typeof s!=='string' || s.length>1000)) throw new Error('AI returned an invalid explanation.');
  const activities=validateDraft(body.activities,days);
  if (activities.some(a=>a.source_item_id!==null)) throw new Error('AI must not reuse item IDs.');
  if (scope!=='trip' && activities.some(a=>a.day_number!==day)) throw new Error('AI changed activities outside the selected day.');
  if (scope==='activity' && activities.length!==1) throw new Error('AI must return exactly one replacement activity.');
  if (scope==='trip' && new Set(activities.map(a=>a.day_number)).size!==days) throw new Error('The new itinerary must cover every day.');
  return {activities,explanation:body.explanation,uncertainties:body.uncertainties};
}
export function changeSummary(before: EditableActivity[], after: EditableActivity[]) {
  const changes: { kind: 'Added'|'Removed'|'Updated'|'Moved'; day: number; text: string }[]=[];
  for (const old of before) if (!after.some(a=>a.source_item_id===old.source_item_id)) changes.push({kind:'Removed',day:old.day_number,text:`${old.title} · ${old.start_time ?? 'Flexible'}`});
  for (const a of after) {
    const old=a.source_item_id ? before.find(b=>b.source_item_id===a.source_item_id) : null;
    if (!old) { changes.push({kind:'Added',day:a.day_number,text:a.title}); continue; }
    if (a.day_number!==old.day_number || a.position!==old.position) changes.push({kind:'Moved',day:a.day_number,text:`${a.title}: Day ${old.day_number}, #${old.position+1} → Day ${a.day_number}, #${a.position+1}`});
    const fields = (['title','description','location','start_time'] as const).filter(k=>a[k]!==old[k]);
    if (fields.length) changes.push({kind:'Updated',day:a.day_number,text:`${old.title} · ${fields.map(k=>`${{title:'Title',description:'Description',location:'Location',start_time:'Time'}[k]}: ${old[k] ?? 'Not set'} → ${a[k] ?? 'Not set'}`).join('; ')}`});
  }
  return changes;
}
