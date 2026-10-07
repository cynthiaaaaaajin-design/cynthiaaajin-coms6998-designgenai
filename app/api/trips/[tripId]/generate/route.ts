import { createClient } from '@/lib/supabase/server';
import { buildPrompt, parsePreferences, tripDayCount, validTripId } from '@/lib/itinerary';
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
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'Invalid request origin.' }, 403);

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return json({ error: 'Please log in to generate an itinerary.' }, 401);

  const { data: trip, error: tripError } = await supabase.from('trips')
    .select('title,destination,start_date,end_date')
    .eq('id', tripId).eq('user_id', user.id).maybeSingle();
  if (tripError) return json({ error: 'Your trip could not be loaded. Please try again.' }, 500);
  if (!trip) return json({ error: 'Trip not found or you are not its owner.' }, 404);

  const { data: existing, error: existingError } = await supabase.from('itinerary_versions')
    .select('id').eq('trip_id', tripId).order('version_number', { ascending: false }).limit(1).maybeSingle();
  if (existingError) return json({ error: 'Could not check saved itineraries. Please check database access and try again.' }, 500);
  if (existing) return json({ versionId: existing.id, existing: true });

  let prompt: string;
  let days: number;
  try {
    const body = await request.text();
    if (body.length > 12000) return json({ error: 'Trip preferences are too long.' }, 400);
    let input: unknown;
    try { input = JSON.parse(body); } catch { return json({ error: 'Send valid JSON trip preferences.' }, 400); }
    const preferences = parsePreferences(input);
    if (!trip.destination?.trim()) return json({ error: 'Add a destination to this trip before generating.' }, 400);
    days = tripDayCount(trip.start_date, trip.end_date);
    prompt = buildPrompt(trip, preferences, days);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid trip preferences.' }, 400);
  }

  const { data: version, error: versionError } = await supabase.from('itinerary_versions').insert({
    trip_id: tripId,
    version_number: 1,
    created_by: user.id,
    source: 'ai_initial',
    prompt_text: prompt,
    response_text: null,
    // created_at uses the database default; parent_version_id remains null.
  }).select('id').single();
  if (versionError || !version) {
    return json({ error: versionError?.code === '23505'
      ? 'An itinerary already exists. Refresh the page to view it.'
      : 'The itinerary could not be saved. Check itinerary_versions access and try again.' },
    versionError?.code === '23505' ? 409 : 500);
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
      error: await geminiErrorDetails(generationError, 'Generation API route') })
    : generated!.responseText;
  const { data: savedResponse, error: responseError } = await supabase.from('itinerary_versions')
    .update({ response_text: responseText }).eq('id', version.id).select('id').single();
  if (responseError || !savedResponse) {
    await logGeminiError(responseError ?? new Error('No itinerary version was updated.'), 'Generation response persistence failed');
    if (failed) await logGeminiError(generationError, 'Generation API route');
    return json({ error: 'The prompt was saved, but the generation result could not be saved. Please check itinerary_versions access.' }, 500);
  }
  if (failed || !generated) {
    const category = await logGeminiError(generationError, 'Generation API route');
    return json({ error: 'AI generation failed. Please try again later.', category }, 502);
  }

  // One bulk INSERT: Postgres either inserts every activity in this statement or none.
  const { error: itemsError } = await supabase.from('itinerary_items').insert(
    generated.activities.map(activity => ({ ...activity, version_id: version.id, origin: 'ai' })),
  );
  if (itemsError) {
    // Preserve the saved generation; do not delete history or silently generate a replacement.
    return json({ error: 'The AI response was saved, but its activities could not be saved. Refresh to view the saved version and contact the app maintainer to check itinerary_items access. No replacement will be generated.' }, 500);
  }
  return json({ versionId: version.id }, 201);
}
