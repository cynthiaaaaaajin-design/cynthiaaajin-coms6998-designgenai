import type { CSSProperties } from "react";
import Link from "next/link";
import { TripCoverArt } from "@/components/trip-cover-art";
import { normalizeDestination } from "@/lib/destinations";

export type Trip = {
  id: string | number;
  isOwner: boolean;
  ownerName: string | null;
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
  const destination = normalizeDestination(trip.destination ?? "");
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
    <article className="trip-card motion-card" style={{ "--entrance-delay": `${Math.min(index, 4) * 35}ms` } as CSSProperties}>
      <div className="destination-art illustrated-cover">
        <TripCoverArt destination={trip.destination ?? ""} />
        <span className="destination-label break-words">{destination.canonical}</span>
        <span className="sample-label">{trip.isOwner ? "Owner" : "Shared with you"}</span>
      </div>
      <div className="p-6">
        <p className="eyebrow mb-2">{dates}</p>
        <h3 className="break-words text-xl font-semibold tracking-tight">
          {trip.title?.trim() || "Untitled adventure"}
        </h3>
        {!trip.isOwner && <p className="mt-2 text-sm text-slate-500">Owned by {trip.ownerName || "another traveler"}</p>}
        <Link href={`/trips/${trip.id}`} className="button-secondary mt-5">
          Open trip <span className="cta-arrow" aria-hidden="true">↗</span>
        </Link>
      </div>
    </article>
  );
}
