import { createClient } from '@/lib/supabase/server';
import { tripDayCount, validTripId, type ItineraryActivity } from '@/lib/itinerary';
import { loadVoteRows } from '@/lib/feedback-server';
import { buildRevisionPrompt } from '@/lib/revision';
import { generateItinerary } from '@/lib/gemini';
import { geminiErrorDetails, logGeminiError } from '@/lib/gemini-errors';

export const runtime = 'nodejs';
export const maxDuration = 120;

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  if (!validTripId(tripId)) return json({ error: 'Invalid trip ID.' }, 400);
  const origin = request.headers.get('origin');
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
    return json({ error: 'Invalid request origin.' }, 403);
  }
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return json({ error: 'Please log in to revise this itinerary.' }, 401);
  const { data: trip, error: tripError } = await supabase.from('trips')
    .select('destination,start_date,end_date').eq('id', tripId).eq('user_id', user.id).maybeSingle();
  if (tripError) return json({ error: 'The trip could not be loaded.' }, 500);
  if (!trip) return json({ error: 'Trip not found or you are not its owner.' }, 404);

  const { data: previous, error: versionError } = await supabase.from('itinerary_versions')
    .select('id,version_number').eq('trip_id', tripId)
    .order('version_number', { ascending: false }).limit(1).maybeSingle();
  if (versionError) return json({ error: 'The latest itinerary could not be loaded.' }, 500);
  if (!previous) return json({ error: 'Generate your first itinerary before revising.' }, 409);
  const { data: original, error: originalError } = await supabase.from('itinerary_versions')
    .select('prompt_text').eq('trip_id', tripId).eq('source', 'ai_initial')
    .order('version_number', { ascending: true }).limit(1).maybeSingle();
  if (originalError || !original?.prompt_text?.trim()) {
    return json({ error: 'Original trip constraints could not be loaded. Revision was not started.' }, 500);
  }
  const { data: items, error: itemsError } = await supabase.from('itinerary_items')
    .select('id,day_number,position,start_time,title,description,location')
    .eq('version_id', previous.id).order('day_number').order('position');
  if (itemsError) return json({ error: 'The previous activities could not be loaded.' }, 500);
  if (!items?.length) return json({ error: 'The latest version has no saved activities. Resolve its save/access issue before revising.' }, 409);

  let days: number;
  try {
    days = tripDayCount(trip.start_date, trip.end_date);
    if (!trip.destination?.trim()) throw new Error('This trip needs a destination before revising.');
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid trip details.' }, 400);
  }
  let prompt: string;
  try {
    const votes = await loadVoteRows(supabase, items.map(item => item.id));
    prompt = buildRevisionPrompt(trip, original.prompt_text, previous.version_number,
      items as (ItineraryActivity & { id: string })[], votes, days);
  } catch {
    return json({ error: 'Group feedback could not be loaded. Revision was not started.' }, 500);
  }
  const versionNumber = previous.version_number + 1;
  const { data: version, error: insertError } = await supabase.from('itinerary_versions').insert({
    trip_id: tripId,
    version_number: versionNumber,
    parent_version_id: previous.id,
    created_by: user.id,
    source: 'ai_revision',
    prompt_text: prompt,
    response_text: null,
  }).select('id').maybeSingle();
  if (insertError || !version) {
    console.error('[Revision persistence]', JSON.stringify({
      operation: 'insert', table: 'itinerary_versions', filters: {},
      tripId, versionNumber, createdBy: user.id, returnedRows: version ? 1 : 0,
      error: insertError,
    }));
    return json({ error: insertError?.code === '23505'
      ? 'A newer itinerary was saved. Refresh to view it before revising again.'
      : 'The revised itinerary could not be saved. Please check your trip access and try again.' },
    insertError?.code === '23505' ? 409 : 500);
  }
  // The prompt is durable before Gemini is called. Only this new attempt is completed.
  let generated;
  let rawResponse: string | undefined;
  let generationError: unknown;
  let failed = false;
  try {
    generated = await generateItinerary(prompt, days, text => { rawResponse = text; });
  } catch (error) {
    failed = true;
    generationError = error;
  }
  const responseText = failed
    ? JSON.stringify({ response_text: rawResponse ?? null,
      error: await geminiErrorDetails(generationError, 'Revision API route') })
    : generated!.responseText;
  const { data: savedResponse, error: responseError } = await supabase.from('itinerary_versions')
    .update({ response_text: responseText }).eq('id', version.id)
    .eq('trip_id', tripId).eq('created_by', user.id).select('id').maybeSingle();
  if (responseError || !savedResponse) {
    console.error('[Revision persistence]', JSON.stringify({
      stage: 'Revision response persistence failed', operation: 'update',
      table: 'itinerary_versions',
      filters: { id: version.id, trip_id: tripId, created_by: user.id },
      returnedRows: savedResponse ? 1 : 0, error: responseError,
    }));
    // Read under the same owner session: distinguish a visible but non-updatable
    // row from a missing/SELECT-hidden row without bypassing RLS.
    const { data: visible, error: readError } = await supabase.from('itinerary_versions')
      .select('id').eq('id', version.id).eq('trip_id', tripId)
      .eq('created_by', user.id).maybeSingle();
    console.error('[Revision persistence]', JSON.stringify({
      operation: 'select', table: 'itinerary_versions',
      filters: { id: version.id, trip_id: tripId, created_by: user.id },
      returnedRows: visible ? 1 : 0, error: readError,
      diagnosis: visible ? 'Row is SELECT-visible; check UPDATE RLS/policies or update-suppressing triggers.'
        : 'Row is missing or hidden by SELECT RLS; check access and row existence.',
    }));
    if (failed) await logGeminiError(generationError, 'Revision API route');
    return json({ error: 'The prompt was saved, but the revision response update did not return a row. Check itinerary_versions UPDATE/SELECT permissions and the server diagnostics. No new activities were saved.' }, 500);
  }
  if (failed || !generated) {
    const category = await logGeminiError(generationError, 'Revision API route');
    return json({ error: 'AI revision failed. Please try again later.', category }, 502);
  }

  const { error: activitiesError } = await supabase.from('itinerary_items').insert(
    generated.activities.map(activity => ({ ...activity, version_id: version.id, origin: 'ai' })),
  );
  if (activitiesError) {
    return json({ error: 'The revision response was saved, but its activities could not be saved. Refresh and contact the app maintainer. Previous versions are preserved.' }, 500);
  }
  return json({ versionId: version.id, versionNumber }, 201);
}
