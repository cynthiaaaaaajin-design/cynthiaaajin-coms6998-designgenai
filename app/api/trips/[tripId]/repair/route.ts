import { createClient } from '@/lib/supabase/server';
import { parseActivities, tripDayCount, validTripId } from '@/lib/itinerary';
import { generateItinerary } from '@/lib/gemini';

export const runtime = 'nodejs';
export const maxDuration = 120;
const failure = "We couldn't restore this itinerary. Please try again.";
function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const origin = request.headers.get('origin');
  if (!validTripId(tripId) || (origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: failure }, 400);
  let stage = 'authorization';
  let method: 'saved_response' | 'saved_prompt' = 'saved_response';
  let versionId: string | undefined;
  // Whitelist diagnostics: provider/database messages can contain supplied content.
  function diagnostic(outcome: string, error?: unknown) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
    console.info('[Itinerary repair]', JSON.stringify({ tripId, versionId, stage, method, outcome, code: code && /^[A-Z0-9_]{1,30}$/.test(code) ? code : undefined }));
  }
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return json({ error: failure }, 401);
    const { data: trip, error: tripError } = await supabase.from('trips')
      .select('start_date,end_date').eq('id', tripId).eq('user_id', user.id).maybeSingle();
    if (tripError) throw tripError;
    if (!trip) return json({ error: failure }, 403);
    const body = await request.text();
    if (body.length > 1024) return json({ error: failure }, 400);
    const input = JSON.parse(body);
    if (typeof input?.versionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.versionId)) return json({ error: failure }, 400);
    versionId = input.versionId;
    stage = 'load version';
    const { data: version, error: versionError } = await supabase.from('itinerary_versions')
      .select('id,source,prompt_text,response_text').eq('id', versionId).eq('trip_id', tripId).maybeSingle();
    if (versionError) throw versionError;
    if (!version || !['ai_initial', 'ai_revision'].includes(version.source)) return json({ error: failure }, 404);
    async function isEmpty() {
      const { count, error } = await supabase.from('itinerary_items')
        .select('id', { count: 'exact', head: true }).eq('version_id', version!.id);
      if (error) throw error;
      if (count === null) throw new Error('Item count unavailable');
      return count === 0;
    }
    stage = 'check empty';
    if (!await isEmpty()) { diagnostic('not empty'); return json({ error: failure }, 409); }
    const days = tripDayCount(trip.start_date, trip.end_date);
    let activities;
    stage = 'parse saved response';
    try {
      let text = version.response_text;
      // Older failed-attempt records wrap the captured model text in diagnostics JSON.
      const stored = JSON.parse(text ?? 'null');
      if (stored && typeof stored.response_text === 'string') text = stored.response_text;
      activities = parseActivities(text ?? '', days);
    } catch { /* Fall back only when saved content cannot pass the existing validator. */ }
    let regeneratedResponse: string | undefined;
    if (!activities) {
      method = 'saved_prompt';
      if (!version.prompt_text?.trim()) throw new Error('No saved prompt');
      stage = 'generate from saved prompt';
      const generated = await generateItinerary(version.prompt_text, days, undefined, false);
      activities = generated.activities;
      regeneratedResponse = generated.responseText;
    }
    // Every repair must share this unique slot, so two concurrent repairs cannot
    // both insert disjoint sets. Ordinary generated itineraries start at this slot.
    if (!activities.some(activity => activity.day_number === 1 && activity.position === 0)) {
      throw new Error('Missing initial activity slot');
    }
    stage = 'recheck empty';
    if (!await isEmpty()) { diagnostic('not empty'); return json({ error: failure }, 409); }
    stage = 'insert items';
    // INSERT only; the existing unique version/day/position constraint also rejects
    // colliding repairs. Never upsert/delete any activities or modify version metadata.
    const { error: insertError } = await supabase.from('itinerary_items').insert(
      activities.map(activity => ({ ...activity, version_id: version.id, origin: 'ai' })),
    );
    if (insertError) throw insertError;
    // Only the request that inserted the recovered items may store its new response.
    if (regeneratedResponse !== undefined) {
      stage = 'save regenerated response';
      const { data, error } = await supabase.from('itinerary_versions')
        .update({ response_text: regeneratedResponse }).eq('id', version.id).eq('trip_id', tripId).select('id').maybeSingle();
      if (error || !data) {
        // Items are already durable: report successful recovery, not an invitation
        // to regenerate a now-healthy version. Keep the discrepancy in server logs.
        diagnostic('items restored; response persistence failed', error);
      }
    }
    stage = 'complete';
    diagnostic('restored');
    return json({ versionId: version.id, method }, 201);
  } catch (error) {
    diagnostic('failed', error);
    return json({ error: failure }, 500);
  }
}
