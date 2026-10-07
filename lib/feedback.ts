export type VoteValue = 1 | -1;
export type CurrentVote = { value: VoteValue; comment: string | null };
export type FeedbackSummary = {
  likes: number;
  dislikes: number;
  mine: CurrentVote | null;
  group: (CurrentVote & { userId: string; name: string | null })[];
};
export type VoteRow = CurrentVote & { id: string; item_id: string; user_id: string };

export function emptyFeedback(): FeedbackSummary {
  return { likes: 0, dislikes: 0, mine: null, group: [] };
}

export function parseFeedback(input: unknown): { item_id: string; value: VoteValue; comment: string | null } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Choose Like or Dislike.');
  const data = input as Record<string, unknown>;
  if (typeof data.item_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(data.item_id)) {
    throw new Error('Invalid itinerary item.');
  }
  if (data.value !== 1 && data.value !== -1) throw new Error('Choose Like or Dislike.');
  if (data.comment != null && (typeof data.comment !== 'string' || data.comment.length > 2000)) {
    throw new Error('Comments must be text of at most 2,000 characters.');
  }
  // Deliberately whitelist fields. A client-supplied user_id is never used.
  return { item_id: data.item_id, value: data.value, comment: typeof data.comment === 'string' ? data.comment.trim() || null : null };
}

export function latestVotes(rows: VoteRow[]): VoteRow[] {
  const latest = new Map<string, VoteRow>();
  for (const row of rows) {
    const key = `${row.item_id}:${row.user_id}`;
    const previous = latest.get(key);
    // Compare bigint IDs without losing precision; timestamps can tie.
    if (!previous || BigInt(row.id) > BigInt(previous.id)) latest.set(key, row);
  }
  return [...latest.values()];
}

export function summarizeVotes(rows: VoteRow[], userId: string): Record<string, FeedbackSummary> {
  const result: Record<string, FeedbackSummary> = {};
  for (const row of latestVotes(rows)) {
    const summary = result[row.item_id] ??= emptyFeedback();
    if (row.value === 1) summary.likes++;
    else if (row.value === -1) summary.dislikes++;
    summary.group.push({ userId: row.user_id, name: null, value: row.value, comment: row.comment });
    if (row.user_id === userId) summary.mine = { value: row.value, comment: row.comment };
  }
  for (const summary of Object.values(result)) summary.group.sort((a, b) => a.userId.localeCompare(b.userId));
  return result;
}
