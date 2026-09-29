import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Header } from "@/components/header";
import { AuthButton } from "@/components/auth-buttons";
import { TripCard } from "@/components/trip-card";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { auth_error } = await searchParams;
  return (
    <>
      <Header signedIn={!!user} />
      <main className="page-shell">
        <section className="hero">
          <div className="hero-copy">
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
              Bring your people, your saved places, and your big ideas into one
              happy plan. Your next adventure starts here.
            </p>
            <div className="mt-8">
              {user ? (
                <Link className="button-primary" href="/trips">
                  Go to my trips <span aria-hidden="true">↗</span>
                </Link>
              ) : (
                <AuthButton />
              )}
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
            <TripCard />
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
              A peek at what we’re building
            </p>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {[
              [
                "01",
                "Find your shared favorites",
                "A tucked-away café? A sunrise hike? Give everyone’s ideas a place to land.",
              ],
              [
                "02",
                "Make a plan that clicks",
                "Bring the who, what, and when together in an itinerary everyone can follow.",
              ],
              [
                "03",
                "Keep everyone in the loop",
                "One shared home for the details, so nobody has to scroll back 200 messages.",
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
      </footer>
    </>
  );
}
