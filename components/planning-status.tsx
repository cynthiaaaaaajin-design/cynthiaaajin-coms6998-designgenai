/** Indeterminate presentation only; does not simulate backend progress. */
export function PlanningStatus({ revision = false }: { revision?: boolean }) {
  return <div className="planning-status" role="status">
    <span className="planning-sparkle" aria-hidden="true">✧</span>
    <div>
      <p className="font-semibold">{revision ? 'Shaping your next version…' : 'Planning your trip…'}</p>
      <p className="mt-1 text-sm text-slate-500">{revision ? 'Your group’s feedback is part of the plan. Keep this page open while we prepare your itinerary.' : 'A thoughtful plan takes a moment. Keep this page open while we prepare your itinerary.'}</p>
    </div>
  </div>;
}
