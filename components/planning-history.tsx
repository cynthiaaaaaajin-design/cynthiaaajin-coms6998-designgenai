import Link from 'next/link';
import type { ItineraryVersion } from '@/lib/itinerary';
export function PlanningHistory({ tripId, versions, selectedId, reviews }: { tripId: string; versions: ItineraryVersion[]; selectedId: string; reviews: Record<string, { reviewed: number; total: number }> | null }) {
  return <details className="planning-history"><summary>Planning history · {versions.length} {versions.length === 1 ? 'saved plan' : 'saved plans'}</summary>
    <p className="mt-2 text-sm">AI revisions use group feedback to help refine the plan. Feedback below is currently stored for each version, not a snapshot of what was used at generation time.</p>
    <ol>{[...versions].reverse().map((version, index) => {
      const date = new Date(version.created_at);
      const label = version.source === 'manual' ? 'Manually edited plan' : version.source === 'ai_revision' ? 'AI revised plan' : index === 0 ? 'First AI draft' : 'AI draft';
      const stats = reviews?.[version.id];
      return <li key={version.id}><Link href={`/trips/${tripId}?version=${version.id}`} aria-current={version.id === selectedId ? 'page' : undefined}><strong>{label}</strong> · Version {version.version_number}</Link>
        <time dateTime={version.created_at}>{Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC'}</time>
        <p>{stats ? `${stats.reviewed} of ${stats.total} activities have group feedback` : 'Feedback history unavailable'}</p>
      </li>;
    })}</ol>
  </details>;
}
