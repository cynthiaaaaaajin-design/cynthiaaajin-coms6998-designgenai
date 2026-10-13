import type { FeedbackSummary } from './feedback';
export function calculateConsensus(itemIds: string[], feedback: Record<string, FeedbackSummary>, participantIds: string[]) {
  const participants = new Set(participantIds);
  const items = [...new Set(itemIds)];
  const voters = new Set<string>();
  let reviewed = 0, responses = 0, positive = 0, negative = 0, mixed = 0;
  for (const id of items) {
    // Summaries already contain only the latest vote per user/activity.
    const votes = new Map((feedback[id]?.group ?? []).filter(vote => participants.has(vote.userId)).map(vote => [vote.userId, vote]));
    if (votes.size) reviewed++;
    let likes = 0, dislikes = 0;
    for (const vote of votes.values()) { voters.add(vote.userId); responses++; if (vote.value === 1) likes++; else dislikes++; }
    if (likes) positive++;
    if (dislikes) negative++;
    if (likes && dislikes) mixed++;
  }
  const expected = participants.size * items.length;
  return { activities: items.length, participants: participants.size, participating: voters.size, reviewed, responses, expected,
    percentage: expected ? Math.round(responses / expected * 100) : 0, positive, negative, mixed,
    awaiting: items.length - reviewed, pending: expected - responses };
}
