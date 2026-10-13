import Link from "next/link";
import { redirect } from "next/navigation";
import { tripDestination } from "@/lib/auth-destination";
import { createClient } from "@/lib/supabase/server";
import { Header } from "@/components/header";
import { AuthButton } from "@/components/auth-buttons";
import { TripCard } from "@/components/trip-card";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string; next?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { auth_error, next } = await searchParams;
  const destination = tripDestination(next);
  if (user) redirect(destination ?? "/trips");
  return (
    <>
      <Header signedIn={!!user} />
      <main className="page-shell mode-landing">
        <section className="hero">
          <div className="hero-copy">
            <div className="route-motif" aria-hidden="true" />
            <p className="pill">A little less planning. A lot more going.</p>
            <h1>
              Great trips.
              <br />
              Better <span className="text-teal-700">together.</span>
            </h1>
            <p className="mt-6 max-w-lg text-xl leading-relaxed text-slate-600">
              Plan trips together, without the group chat chaos.
            </p>
            <p className="mt-4 max-w-md leading-7 text-slate-500">
              Generate a day-by-day itinerary, gather your group’s feedback, and
              revise the plan together.
            </p>
            <div className="mt-8">
              <AuthButton next={destination} />
            </div>
            {auth_error && (
              <p role="alert" className="mt-4 text-sm text-red-700">
                Google sign-in didn’t finish. Please try again.
              </p>
            )}
            <p className="mt-4 text-xs text-slate-500">
              For the weekend escapes and the once-in-a-lifetimes.
            </p>
          </div>
          <div className="hero-preview">
            <div className="preview-caption">
              <span className="status-dot" /> Your next “remember when…”
            </div>
            <TripCard video={process.env.LANDING_VIDEO_ENABLED !== "false"} />
            <div className="floating-note">
              <span className="note-icon">✓</span>
              <div>
                <strong>Less back-and-forth</strong>
                <p>More “see you at the airport.”</p>
              </div>
            </div>
          </div>
        </section>
        <section id="how-it-works" className="features-section">
          <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow">THE PLAN, ALL IN ONE PLACE</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight">
                Different people. One great trip.
              </h2>
            </div>
            <p className="text-sm text-slate-500">
              From first idea to a shared itinerary
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {[
              [
                "01",
                "Create your trip",
                "Choose your destination and dates, then add travelers who already use TripSync.",
              ],
              [
                "02",
                "Generate your itinerary",
                "Turn your budget and interests into a day-by-day plan with AI.",
              ],
              [
                "03",
                "Vote and revise together",
                "Like, Dislike, and comment on activities. The trip owner can revise the plan with everyone’s feedback.",
              ],
            ].map(([n, title, copy]) => (
              <article key={n} className="feature-card">
                <span className="feature-number">{n}</span>
                <h3 className="mt-6 text-lg font-semibold">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-500">{copy}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
      <footer className="page-shell py-8 text-sm text-slate-500">
        TripSync. Made for making memories together.
        <span className="ml-4 inline-flex gap-4"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></span>
      </footer>
    </>
  );
}
