import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfig } from "@/lib/supabase/config";
import { Header } from "@/components/header";
import { SavedTripCard, type Trip } from "@/components/saved-trip-card";
import { loadPrivateTrips } from "@/lib/travelers-server";

export default async function Trips() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const { data: profile } = await supabase
    .from("profiles")
    .select("email,first_name,last_name")
    .eq("id", user.id)
    .maybeSingle();
  let trips: Trip[] = [];
  let tripsError: Error | null = null;
  try { trips = await loadPrivateTrips(supabase, user.id); }
  catch (error) { tripsError = error instanceof Error ? error : new Error("Trip access could not be checked."); }
  console.info("[trips] Query result", JSON.stringify({
    projectHost: new URL(supabaseConfig().url).hostname,
    userId: user.id,
    tripsReturned: trips?.length ?? 0,
    querySucceeded: !tripsError,
  }));
  if (tripsError) {
    console.error("[trips] Query failed", {
      message: tripsError.message,
    });
  }
  const incomplete =
    !profile?.first_name?.trim() || !profile?.last_name?.trim();
  return (
    <>
      <Header signedIn active="trips" />
      <main className="page-shell mode-dashboard py-12">
        <p className="eyebrow">YOUR NEXT CHAPTER</p>
        <h1 className="page-title">
          Oh, the places you’ll go
          {profile?.first_name?.trim() ? `, ${profile.first_name.trim()}` : ""}.
        </h1>
        <p className="mt-4 text-slate-500">
          A home for your next adventure and the people coming along.
        </p>
        {incomplete && (
          <div className="notice mt-8">
            Before you head out, add your first and last name.{" "}
            <Link className="font-semibold underline" href="/profile">
              Complete your profile →
            </Link>
          </div>
        )}
        <section className="dashboard-banner">
          <div>
            <div className="route-motif" aria-hidden="true" />
            <p className="eyebrow">GOOD COMPANY. GREAT POSSIBILITIES.</p>
            <h2 className="mt-3 text-3xl font-semibold">
              The best part of the trip? Your people.
            </h2>
            <p className="mt-4 max-w-xl leading-7 text-slate-600">
              Pick your destination, create a private trip, and shape the itinerary together.
            </p>
            <Link className="button-primary mt-6" href="/trips/new">
              + Plan a new trip
            </Link>
          </div>
          <span className="banner-compass" aria-hidden="true">
            ✧
          </span>
        </section>
        {tripsError ? <div className="notice mt-12" role="alert">We couldn’t load your trips. Please refresh to try again.</div> : <>
          {[{ title: 'MY TRIPS', owned: true }, { title: 'SHARED WITH ME', owned: false }].map(section => (
            <section key={section.title} className={`journal-section mt-12 ${section.owned ? "journal-owned" : "journal-shared"}`}>
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><h2 className="text-2xl font-semibold">{section.title}</h2></div>
              <p className="mb-5 text-sm text-slate-500">{section.owned ? 'Plan your itinerary, manage travelers, and gather feedback.' : 'Open a shared itinerary to Like, Dislike, and leave comments.'}</p>
              {trips.some(trip => trip.isOwner === section.owned) ? <div className="grid gap-6 md:grid-cols-3">
                {trips.filter(trip => trip.isOwner === section.owned).map((trip, index) => <SavedTripCard key={trip.id} trip={trip} index={index} viewerName={[profile?.first_name, profile?.last_name].filter(Boolean).join(" ")} />)}
              </div> : <div className="settings-card text-sm text-slate-500">{section.owned ? <><p>Your next adventure is still unwritten.</p><Link href="/trips/new" className="button-primary mt-4">Plan your first trip</Link></> : 'Trips shared with you will appear here.'}</div>}
            </section>
          ))}
          <section className="journal-section journal-feedback mt-8" aria-labelledby="recent-feedback-title">
            <p className="eyebrow">THE CONVERSATION CONTINUES</p>
            <h2 id="recent-feedback-title" className="mt-3 text-2xl font-semibold">Recent feedback</h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">Your latest votes and comments live with each itinerary. Open a trip to see the group’s current feedback and add your take.</p>
            <div className="mt-4 flex flex-wrap gap-3">{trips.slice(0, 3).map(trip => <Link className="button-secondary" key={trip.id} href={`/trips/${trip.id}`}>{trip.title || 'Open itinerary'} <span aria-hidden="true">↗</span></Link>)}</div>
            {trips.length === 0 && <p className="mt-3 text-sm text-slate-500">Plan a trip or join your travel crew to start the conversation.</p>}
          </section>
        </>}
      </main>
    </>
  );
}
