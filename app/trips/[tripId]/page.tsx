import { TripCoverArt } from "@/components/trip-cover-art";
import { normalizeDestination } from "@/lib/destinations";
import type { CSSProperties } from 'react';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Header } from '@/components/header';
import { GenerateItineraryForm } from '@/components/generate-itinerary-form';
import { ActivityFeedback } from '@/components/activity-feedback';
import { ReviseItineraryButton } from '@/components/revise-itinerary-button';
import { ItineraryVersionSelector } from '@/components/itinerary-version-selector';
import { ManageTravelers } from '@/components/manage-travelers';
import { loadTravelers } from '@/lib/travelers-server';
import type { Traveler } from '@/lib/travelers';
import { createClient } from '@/lib/supabase/server';
import { accessibleTrip, loadFeedback } from '@/lib/feedback-server';
import { emptyFeedback, type FeedbackSummary } from '@/lib/feedback';
import { tripDayCount, validTripId, type ItineraryActivity, type ItineraryVersion } from '@/lib/itinerary';

function formatDate(value: string | null) {
  if (!value) return 'Not set';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? 'Not set' : new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(date);
}

export default async function TripDetail({ params, searchParams }: {
  params: Promise<{ tripId: string }>;
  searchParams: Promise<{ version?: string | string[] }>;
}) {
  const { tripId } = await params;
  const { version: selectedId } = await searchParams;
  if (!validTripId(tripId)) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/');

  const trip = await accessibleTrip(supabase, tripId, user.id);
  if (!trip) notFound();
  const isOwner = trip.user_id === user.id;
  let travelers: Traveler[] = [];
  let travelersError = false;
  if (isOwner) {
    try { travelers = await loadTravelers(supabase, tripId); }
    catch { travelersError = true; }
  }

  const versions: ItineraryVersion[] = [];
  let versionError = false;
  let cursor: number | undefined;
  while (true) {
    let query = supabase.from('itinerary_versions')
      .select('id,version_number,source,created_at').eq('trip_id', tripId)
      .order('version_number', { ascending: false }).limit(200);
    if (cursor !== undefined) query = query.lt('version_number', cursor);
    const { data, error } = await query;
    if (error) { versionError = true; break; }
    if (!data?.length) break;
    versions.push(...data);
    cursor = data[data.length - 1].version_number;
  }
  const version = selectedId ? versions.find(entry => entry.id === selectedId) : versions[0];
  if (selectedId && !version && !versionError) notFound();
  const isCurrent = !!version && version.id === versions[0]?.id;
  let items: (ItineraryActivity & { id: string })[] = [];
  let itemsError = false;
  if (version) {
    const result = await supabase.from('itinerary_items')
      .select('id,day_number,position,start_time,title,description,location')
      .eq('version_id', version.id).order('day_number').order('position');
    items = result.data ?? [];
    itemsError = !!result.error;
  }
  let feedback: Record<string, FeedbackSummary> = {};
  let feedbackError = false;
  if (!itemsError && items.length) {
    try { feedback = await loadFeedback(supabase, items.map(item => item.id), user.id, tripId); }
    catch { feedbackError = true; }
  }
  let generationIssue = '';
  try {
    tripDayCount(trip.start_date, trip.end_date);
    if (!trip.destination?.trim()) generationIssue = 'Add a destination to this trip before generating.';
  } catch (error) {
    generationIssue = error instanceof Error ? error.message : 'Check this trip’s dates.';
  }
  const days = [...new Set(items.map(item => item.day_number))];

  return (
    <>
      <Header signedIn active="trips" />
      <main className="page-shell py-12">
        <Link href="/trips" className="text-sm font-semibold text-teal-800">← Back to your trips</Link>
        <div className="dashboard-banner trip-detail-banner">
          <div className="min-w-0">
            <p className="eyebrow">YOUR NEXT ADVENTURE</p>
            <h1 className="page-title break-words">{trip.title?.trim() || 'Untitled adventure'}</h1>
            <p className="mt-4 break-words text-lg text-slate-600">{normalizeDestination(trip.destination ?? '').canonical}</p>
            <p className="mt-2 text-sm text-slate-500">{formatDate(trip.start_date)} – {formatDate(trip.end_date)}</p>
          </div>
          <div className="trip-detail-cover"><TripCoverArt destination={trip.destination ?? ""} /></div>
        </div>
        {isOwner && <ManageTravelers
          key={`${tripId}:${travelersError}:${JSON.stringify(travelers)}`}
          tripId={tripId} ownerId={user.id} initialTravelers={travelers} loadError={travelersError}
        />}
        {versionError ? (
          <div className="notice mt-8" role="alert">Your saved itinerary could not be loaded. Refresh to try again. Generation is unavailable until we can check existing versions.</div>
        ) : version ? (
          <section className="itinerary-version mt-10" aria-labelledby="itinerary-heading">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="itinerary-heading" className="text-2xl font-semibold">Your itinerary</h2>
              <span key={version.id} className="pill version-badge">Version {version.version_number} · {version.source === 'manual' ? 'Manually edited' : 'AI generated'}</span>
            </div>
            {!isOwner && !feedbackError && !itemsError && items.length > 0 && <div className="my-5 max-w-md">
              <p className="mb-2 flex items-center gap-2 text-sm text-slate-500">
                {items.some(item => !feedback[item.id]?.mine) && <span className="status-dot" aria-hidden="true" />}
                Your feedback: {items.filter(item => feedback[item.id]?.mine).length} of {items.length} activities
              </p>
              <div className="feedback-progress-track" role="progressbar" aria-label="Your itinerary feedback completion" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={items.filter(item => feedback[item.id]?.mine).length}>
                <div className="feedback-progress-fill" style={{ transform: `scaleX(${items.filter(item => feedback[item.id]?.mine).length / items.length})` }} />
              </div>
            </div>}
            <ItineraryVersionSelector tripId={tripId} versions={versions} selectedId={version.id} />
            <p className="mt-3 text-sm text-slate-500">{isCurrent ? 'Your latest saved plan.' : 'An earlier saved plan. Feedback is read-only for this version.'} Check opening hours and availability before you go.</p>
            {!isCurrent && <Link href={`/trips/${tripId}`} className="button-secondary mt-4">Back to current itinerary</Link>}
            {isCurrent && isOwner && !itemsError && items.length > 0 && !feedbackError && !generationIssue &&
              <ReviseItineraryButton key={version.id} tripId={tripId} />}
            {itemsError ? (
              <p className="notice mt-6" role="alert">Your activities could not be loaded. Please refresh to try again.</p>
            ) : items.length === 0 ? (
              <p className="notice mt-6" role="alert">This version is saved, but no activities are available. The activity save may have failed, or access may be restricted. Contact the app maintainer to check this version. Your saved generation will not be replaced.</p>
            ) : days.map(day => (
              <section key={`${version.id}:${day}`} className="itinerary-version mt-8" aria-labelledby={`day-${day}`}>
                <h3 id={`day-${day}`} className="mb-4 text-lg font-semibold">Day {day}</h3>
                <ol className="grid gap-4">
                  {items.filter(item => item.day_number === day).map((item, index) => (
                    <li key={item.id} style={{ "--entrance-delay": `${Math.min(index, 4) * 30}ms` } as CSSProperties} className="activity-card settings-card flex flex-col gap-4 sm:flex-row sm:gap-8">
                      <p className="min-w-16 text-sm font-semibold text-teal-700">{item.start_time?.slice(0, 5) || 'Flexible'}</p>
                      <div className="min-w-0 flex-1">
                        <h4 className="break-words text-lg font-semibold">{item.title}</h4>
                        {item.location && <p className="mt-1 break-words text-sm font-medium text-teal-800">{item.location}</p>}
                        {item.description && <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">{item.description}</p>}
                        <ActivityFeedback
                          key={`${item.id}:${user.id}:${feedbackError ? 'unavailable' : JSON.stringify(feedback[item.id] ?? emptyFeedback())}`}
                          tripId={tripId}
                          itemId={item.id}
                          title={item.title}
                          readOnly={!isCurrent}
                          initialSummary={feedbackError ? null : feedback[item.id] ?? emptyFeedback()}
                        />
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </section>
        ) : !isOwner ? (
          <p className="notice mt-8">Your trip owner hasn’t generated an itinerary yet. Once it’s ready, you can share feedback on each activity.</p>
        ) : generationIssue ? (
          <section className="settings-card mt-8">
            <h2 className="text-2xl font-semibold">Generate itinerary with AI</h2>
            <p className="notice mt-4" role="alert">{generationIssue}</p>
          </section>
        ) : <GenerateItineraryForm tripId={tripId} />}
      </main>
    </>
  );
}
