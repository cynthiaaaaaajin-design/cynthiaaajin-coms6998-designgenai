'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
 return <main className="page-shell community-page"><h1 className="text-2xl font-semibold">Community is temporarily unavailable</h1><p className="my-4">Please try again in a moment.</p><button className="button-primary" onClick={reset}>Try again</button></main>;
}
