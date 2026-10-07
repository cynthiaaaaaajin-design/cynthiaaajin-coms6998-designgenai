import { createClient } from '@/lib/supabase/server';
import { validTripId } from '@/lib/itinerary';
import { emptyFeedback, parseFeedback } from '@/lib/feedback';
import { accessibleTrip, loadFeedback } from '@/lib/feedback-server';

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
  if (authError || !user) return json({ error: 'Please log in to submit feedback.' }, 401);

  let feedback;
  try {
    const body = await request.text();
    if (body.length > 16000) return json({ error: 'Feedback is too long.' }, 400);
    let input: unknown;
    try { input = JSON.parse(body); } catch { return json({ error: 'Send valid JSON feedback.' }, 400); }
    feedback = parseFeedback(input);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Invalid feedback.' }, 400);
  }

  try {
    if (!await accessibleTrip(supabase, tripId, user.id)) {
      return json({ error: 'Trip not found or access is unavailable.' }, 404);
    }
  } catch {
    return json({ error: 'Trip access could not be verified. Please try again.' }, 500);
  }
  const { data: version, error: versionError } = await supabase.from('itinerary_versions')
    .select('id').eq('trip_id', tripId).order('version_number', { ascending: false }).limit(1).maybeSingle();
  if (versionError) return json({ error: 'The current itinerary could not be checked.' }, 500);
  if (!version) return json({ error: 'There is no current itinerary to rate.' }, 409);
  const { data: item, error: itemError } = await supabase.from('itinerary_items').select('id')
    .eq('id', feedback.item_id).eq('version_id', version.id).maybeSingle();
  if (itemError) return json({ error: 'The activity could not be checked.' }, 500);
  if (!item) return json({ error: 'This activity is not in the current itinerary. Refresh the trip before submitting.' }, 409);

  const { error: insertError } = await supabase.from('activity_votes').insert({
    item_id: feedback.item_id,
    user_id: user.id,
    value: feedback.value,
    comment: feedback.comment,
  });
  if (insertError) {
    return json({ error: 'Your feedback could not be saved. Please check your trip access and try again.' }, insertError.code === '42501' ? 403 : 500);
  }
  const saved = { value: feedback.value, comment: feedback.comment };
  try {
    const summaries = await loadFeedback(supabase, [feedback.item_id], user.id, tripId);
    const summary = summaries[feedback.item_id] ?? emptyFeedback();
    if (!summary.mine) throw new Error('Saved feedback is not readable.');
    return json({ summary, saved }, 201);
  } catch {
    // The INSERT succeeded. Do not misreport a failed read as a failed save.
    return json({ summary: null, saved, warning: 'Feedback saved, but updated counts could not be loaded. Refresh to try again.' }, 201);
  }
}
