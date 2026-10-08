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
    <p className="eyebrow mt-8">YOUR PERSONAL TRAVEL CONCIERGE</p><h1 className="page-title">Plan a new trip</h1>
    <p className="mt-4 text-slate-500">Choose a place and your dates. We’ll help you build the itinerary next.</p>
    <CreateTripForm />
  </main></>;
}
