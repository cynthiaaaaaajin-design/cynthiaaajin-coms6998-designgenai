// Retained for callers of the former immediate-revision control.
export function ReviseItineraryButton({ tripId }: { tripId: string }) {
  return <a href={`/trips/${encodeURIComponent(tripId)}#ai-revisions`} className="button-primary mt-5">Review AI revision options</a>;
}
