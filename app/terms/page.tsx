import Link from 'next/link';
export default function Terms() {
  return <main className="page-shell py-12 max-w-3xl"><p className="eyebrow">TRIPSYNC</p><h1 className="page-title">Terms of use</h1>
    <div className="mt-8 space-y-5 leading-7">
      <p>TripSync helps you create and discuss travel plans. Generated itineraries and suggested place matches are planning aids; confirm locations, prices, opening hours, and availability before traveling or booking.</p>
      <p>Only share trip information and content you have permission to share. Trip owners manage traveler access; adding a traveler lets them view the trip and contribute feedback.</p>
      <p>Use of Google Maps features is subject to the <a className="underline" href="https://maps.google.com/help/terms_maps/">Google Maps/Google Earth Additional Terms of Service</a>, incorporated into these terms. Google Maps information and photos retain their displayed provider and author attribution.</p>
      <p>See our <Link className="underline" href="/privacy">Privacy Policy</Link> for how trip data is used.</p>
      <Link className="button-secondary" href="/trips">Back to trips</Link>
    </div></main>;
}
