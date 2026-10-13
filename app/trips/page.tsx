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
    <div className="ocean-dashboard-page">
      <Header signedIn active="trips" />
      <main className="page-shell mode-dashboard ocean-dashboard py-12">
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
        <section className="dashboard-banner dashboard-quick-start">
          <p className="text-sm text-slate-600">Your next adventure starts with a place and a date.</p>
          <Link className="button-primary" href="/trips/new">+ Plan a new trip</Link>
        </section>
        {tripsError ? <div className="notice mt-12" role="alert">We couldn’t load your trips. Please refresh to try again.</div> : (
          <section className="journal-section journal-owned mt-6" aria-labelledby="trip-collection-title">
            <div className="section-heading mb-5">
              <p className="eyebrow">YOUR NEXT ADVENTURES</p>
              <h2 id="trip-collection-title" className="mt-3 text-2xl font-semibold">Trip collection</h2>
            </div>
            <p className="mb-5 text-sm text-slate-500">Your trips and shared adventures, all in one place.</p>
            {trips.length ? <div className="grid gap-6 md:grid-cols-3">
              {trips.map((trip, index) => <SavedTripCard key={trip.id} trip={trip} index={index} viewerName={[profile?.first_name, profile?.last_name].filter(Boolean).join(" ")} />)}
            </div> : <div className="settings-card text-sm text-slate-500"><p>Your next adventure is still unwritten. Create a trip or join one through an invitation link.</p><Link href="/trips/new" className="button-primary mt-4">Plan your first trip</Link></div>}
          </section>
        )}
      </main>
    </div>
  );
}
