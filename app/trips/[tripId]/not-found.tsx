import Link from 'next/link';

export default function TripNotFound() {
  return (
    <main className="page-shell py-12">
      <div className="settings-card">
        <h1 className="text-2xl font-semibold">Trip not found</h1>
        <p className="mt-3 text-slate-500">This trip doesn’t exist or isn’t available to your account.</p>
        <Link className="button-primary mt-6" href="/trips">Back to trips</Link>
      </div>
    </main>
  );
}
