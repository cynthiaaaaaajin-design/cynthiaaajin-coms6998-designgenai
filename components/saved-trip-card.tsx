export type Trip = {
  id: string | number;
  title: string | null;
  destination: string | null;
  start_date: string | null;
  end_date: string | null;
};

function formatDate(value: string | null) {
  if (!value) return null;
  // Date-only values must not move to the previous day in a western timezone.
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function SavedTripCard({ trip, index }: { trip: Trip; index: number }) {
  const style = ["coast", "mountain", "city"][index % 3];
  const start = formatDate(trip.start_date);
  const end = formatDate(trip.end_date);
  const dates =
    start && end
      ? `${start} – ${end}`
      : start
        ? `From ${start}`
        : end
          ? `Until ${end}`
          : "Dates to be decided";
  return (
    <article className="trip-card">
      <div className={`destination-art ${style}`}>
        <span className="art-sun" aria-hidden="true" />
        <span className="art-hill hill-back" aria-hidden="true" />
        <span className="art-hill hill-front" aria-hidden="true" />
        <span className="destination-label break-words">
          {trip.destination?.trim() || "Somewhere wonderful"}
        </span>
        <span className="sample-label">Your trip</span>
      </div>
      <div className="p-6">
        <p className="eyebrow mb-2">{dates}</p>
        <h3 className="break-words text-xl font-semibold tracking-tight">
          {trip.title?.trim() || "Untitled adventure"}
        </h3>
        <p className="mt-5 text-sm text-slate-500">Good times ahead.</p>
      </div>
    </article>
  );
}
