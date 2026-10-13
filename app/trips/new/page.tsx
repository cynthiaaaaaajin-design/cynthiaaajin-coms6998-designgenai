import { LandingVideo } from '@/components/landing-video';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Header } from '@/components/header';
import { CreateTripForm } from '@/components/create-trip-form';

export default async function NewTrip() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect('/');
  return <><Header signedIn active="trips" /><main className="page-shell mode-create py-12">
    <Link href="/trips" className="text-sm font-semibold text-teal-800">← Back to your trips</Link>
    <div className="create-trip-layout">
      <aside className="create-trip-scene" aria-label="Travel inspiration">
        <LandingVideo />
        <div className="create-scene-copy"><p className="eyebrow">A LITTLE ESCAPE STARTS HERE</p><h2>Somewhere new.<br />Something to remember.</h2><p>A place, a few days, your favorite people.</p></div>
      </aside>
      <section className="create-trip-panel" aria-labelledby="create-trip-title">
        <p className="eyebrow">MAKE ROOM FOR AN ADVENTURE</p><h1 id="create-trip-title" className="page-title">Plan a new trip</h1>
        <p className="create-trip-intro">Pick your destination and dates. We’ll build the plan next.</p>
        <CreateTripForm />
      </section>
    </div>
  </main></>;
}
