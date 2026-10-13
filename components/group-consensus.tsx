import { calculateConsensus } from '@/lib/consensus';
import type { FeedbackSummary } from '@/lib/feedback';
export function GroupConsensus({ itemIds, feedback, participants }: { itemIds: string[]; feedback: Record<string, FeedbackSummary> | null; participants: string[] | null }) {
  if (!participants || !feedback) return <section className="group-consensus"><p className="eyebrow">GROUP CONSENSUS</p><p className="mt-2">Progress is unavailable until traveler access and feedback can be verified.</p></section>;
  const result = calculateConsensus(itemIds, feedback, participants);
  return <section className="group-consensus" aria-labelledby="consensus-title">
    <div className="consensus-header"><div><p className="eyebrow">GROUP CONSENSUS</p><h3 id="consensus-title">{result.reviewed} of {result.activities} activities reviewed</h3></div><span className="consensus-status">{result.pending ? 'Feedback pending' : 'All feedback received'}</span></div>
    <progress value={result.responses} max={result.expected || 1} aria-label="Participant review completion" />
    <p className="text-sm"><strong>{result.percentage}% complete</strong> · {result.responses} of {result.expected} reviews received</p>
    <div className="consensus-metrics"><span><strong>{result.participating}</strong> of {result.participants} {result.participants === 1 ? 'traveler' : 'travelers'} participating</span><span><strong>{result.awaiting}</strong> activities without feedback</span><span><strong>{result.pending}</strong> reviews pending</span></div>
    <p className="text-sm">{result.positive} activities with Likes · {result.negative} with Dislikes · {result.mixed} with both</p>
  </section>;
}
