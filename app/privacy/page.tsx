import Link from 'next/link';
export default function Privacy() {
  return <main className="page-shell py-12 max-w-3xl"><p className="eyebrow">TRIPSYNC</p><h1 className="page-title">Privacy</h1>
    <div className="mt-8 space-y-5 leading-7">
      <p>TripSync uses Google sign-in and Supabase to manage your account, profile, private trips, traveler access, itineraries, and activity feedback. Trip owners and added travelers can access shared trip content.</p>
      <p>When you generate or revise an itinerary, trip details, planning preferences, and relevant group feedback are sent to Google Gemini to prepare the plan.</p>
      <p>When optional place information is enabled, an activity’s title, location, and trip destination are sent from our server to Google Places to look for a matching place. We do not include your profile, email, or votes in that lookup. Place results are displayed for the current page visit and are not saved to TripSync’s database.</p>
      <p>Google Maps links open Google’s services, where Google’s <a className="underline" href="https://policies.google.com/privacy">Privacy Policy</a> applies. That policy is incorporated here for Google Maps features.</p>
      <Link className="button-secondary" href="/trips">Back to trips</Link>
    </div></main>;
}
