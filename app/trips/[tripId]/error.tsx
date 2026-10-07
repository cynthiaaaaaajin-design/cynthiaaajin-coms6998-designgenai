'use client';

import Link from 'next/link';

export default function TripError({ reset }: { reset: () => void }) {
  return (
    <main className="page-shell py-12">
      <div className="settings-card" role="alert">
        <h1 className="text-2xl font-semibold">Your trip couldn’t be loaded.</h1>
        <p className="mt-3 text-slate-500">Please try again in a moment.</p>
        <div className="mt-6 flex gap-3">
          <button className="button-primary" onClick={reset}>Try again</button>
          <Link className="button-secondary" href="/trips">Back to trips</Link>
        </div>
      </div>
    </main>
  );
}
