import 'server-only';
import type { createClient } from './supabase/server';
import { loadVoteRows } from './feedback-server';
import { latestVotes } from './feedback';
export async function loadPlanningReviews(client: Awaited<ReturnType<typeof createClient>>, versionIds: string[], participants: string[]) {
  const allowed = new Set(participants);
  const result: Record<string, { reviewed: number; total: number }> = {};
  for (const id of versionIds) result[id] = { reviewed: 0, total: 0 };
  for (let batch = 0; batch < versionIds.length; batch += 50) {
    let cursor: string | undefined;
    while (true) {
      let query = client.from('itinerary_items').select('id,version_id').in('version_id', versionIds.slice(batch, batch + 50)).order('id').limit(200);
      if (cursor) query = query.gt('id', cursor);
      const { data, error } = await query;
      if (error) throw new Error('History unavailable');
      if (!data?.length) break;
      const votes = latestVotes(await loadVoteRows(client, data.map(item => item.id))).filter(vote => allowed.has(vote.user_id));
      const reviewed = new Set(votes.map(vote => vote.item_id));
      for (const item of data) { result[item.version_id].total++; if (reviewed.has(item.id)) result[item.version_id].reviewed++; }
      cursor = data[data.length - 1].id;
    }
  }
  return result;
}
