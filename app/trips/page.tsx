import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { supabaseConfig } from "@/lib/supabase/config";
import { Header } from "@/components/header";
import { SavedTripCard, type Trip } from "@/components/saved-trip-card";

export default async function Trips() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/");
  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name,last_name")
    .eq("id", user.id)
    .maybeSingle();
  const { data: trips, error: tripsError } = await supabase
    .from("trips")
    .select("*")
    .eq("user_id", user.id)
    .order("start_date", { ascending: true })
    .returns<Trip[]>();
  console.info("[trips] Query result", JSON.stringify({
    projectHost: new URL(supabaseConfig().url).hostname,
    userId: user.id,
    tripsReturned: trips?.length ?? 0,
    querySucceeded: !tripsError,
  }));
  if (tripsError) {
    console.error("[trips] Query failed", {
      message: tripsError.message,
      code: tripsError.code,
      details: tripsError.details,
      hint: tripsError.hint,
    });
  }
  const incomplete =
    !profile?.first_name?.trim() || !profile?.last_name?.trim();
  return (
    <>
      <Header signedIn active="trips" />
      <main className="page-shell py-12">
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
            <p className="eyebrow">GOOD COMPANY. GREAT POSSIBILITIES.</p>
            <h2 className="mt-3 text-3xl font-semibold">
              The best part of the trip? Your people.
            </h2>
            <p className="mt-4 max-w-xl leading-7 text-slate-600">
              Your travel story starts here. Keep your traveler profile up to
              date and find your saved adventures below.
            </p>
            <Link className="button-secondary mt-6" href="/profile">
              Edit my traveler profile ↗
            </Link>
          </div>
          <span className="banner-compass" aria-hidden="true">
            ✧
          </span>
        </section>
        <section className="mt-12">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-2xl font-semibold">Your trips</h2>
            <span className="text-sm text-slate-500">
              Your saved adventures · by start date
            </span>
          </div>
          {tripsError ? (
            <div className="notice" role="alert">
              <h3 className="font-semibold">We couldn’t load your trips.</h3>
              <p className="mt-2">
                Please refresh the page to try again. Your saved trips haven’t
                changed.
              </p>
            </div>
          ) : trips?.length ? (
            <>
              <div className="grid gap-6 md:grid-cols-3">
                {trips.map((trip, index) => (
                  <SavedTripCard key={trip.id} trip={trip} index={index} />
                ))}
              </div>
            </>
          ) : (
            <div className="settings-card py-12 text-center">
              <span className="text-4xl text-teal-600" aria-hidden="true">
                ✧
              </span>
              <h3 className="mt-4 text-xl font-semibold">
                Your next adventure is still unwritten.
              </h3>
              <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-slate-500">
                You don’t have any saved trips yet. When a trip is added to your
                account, it will appear here. Trip creation and invitations are
                coming soon.
              </p>
              <Link href="/profile" className="button-secondary mt-6">
                Get your profile ready ↗
              </Link>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
