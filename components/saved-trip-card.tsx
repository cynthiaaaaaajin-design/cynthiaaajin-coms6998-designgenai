import { ArrowIcon } from "@/components/arrow-icon";
import { DestinationCoverPhoto } from "@/components/destination-cover-photo";
import { TravelerInitials } from "@/components/traveler-initials";
import type { CSSProperties } from "react";
import Link from "next/link";
import { TripCoverArt } from "@/components/trip-cover-art";
import { normalizeDestination } from "@/lib/destinations";

export type Trip = {
  id: string | number;
  travelerCount?: number | null;
  isOwner: boolean;
  communityAuthor?: string | null;
  communityAdopted?: boolean;
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

export function SavedTripCard({ trip, index, viewerName }: { trip: Trip; index: number; viewerName?: string }) {
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
  const today = new Date().toISOString().slice(0, 10);
  const status = trip.end_date && trip.end_date < today ? 'Past trip' : trip.start_date && trip.end_date && trip.start_date <= today && trip.end_date >= today ? 'In progress' : trip.start_date && trip.start_date > today ? 'Upcoming' : 'Dates to confirm';
  return (
    <article className="trip-card motion-card collection-card" style={{ "--entrance-delay": `${Math.min(index, 4) * 35}ms` } as CSSProperties}>
      <div className="destination-art illustrated-cover saved-trip-cover">
        {(process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_PLACES_API_KEY)
          ? <DestinationCoverPhoto tripId={String(trip.id)} destination={destination.canonical} fallback={<TripCoverArt destination={trip.destination ?? ""} />} />
          : <TripCoverArt destination={trip.destination ?? ""} />}
        <span className="destination-label break-words">{destination.canonical}</span>
        <span className={`sample-label ${trip.isOwner ? "role-owner" : "role-shared"}`}>{trip.communityAuthor ? (trip.communityAdopted ? "Owned" : `Shared by ${trip.communityAuthor}`) : trip.isOwner ? "Owner" : "Shared"}</span>
      </div>
      <div className="collection-card-body">
        <p className="eyebrow mb-2">{dates}</p>
        <h3 className="break-words text-xl font-semibold tracking-tight">
          {trip.title?.trim() || "Untitled adventure"}
        </h3>
        {trip.communityAuthor && <p className="mt-2 text-sm text-slate-500">Inspired by {trip.communityAuthor} · Your independent copy</p>}
        {!trip.isOwner && <p className="mt-2 text-sm text-slate-500">Owned by {trip.ownerName || "another traveler"}</p>}
        <div className="card-crew mt-4"><TravelerInitials name={trip.isOwner ? viewerName : trip.ownerName} /><span>{trip.travelerCount != null ? `${trip.travelerCount} ${trip.travelerCount === 1 ? 'traveler' : 'travelers'}` : trip.isOwner ? 'Your adventure' : 'A shared adventure'}</span></div>
        <p className="collection-status">{status}</p>
        <Link href={`/trips/${trip.id}`} className="button-secondary mt-5">
          Open trip <span className="cta-arrow" aria-hidden="true"><ArrowIcon /></span>
        </Link>
      </div>
    </article>
  );
}
