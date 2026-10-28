import 'server-only';
import type { createClient } from './supabase/server';
export type CommunityOrigin = { trip_id: string; author_name: string; source_post_id: string; adopted_at: string | null };
export async function loadCommunityOrigins(client: Awaited<ReturnType<typeof createClient>>, ids: string[]): Promise<CommunityOrigin[]> {
  if (!ids.length) return [];
  const rows: CommunityOrigin[] = [];
  for (let start = 0; start < ids.length; start += 100) {
    const { data, error } = await client.from('community_imports').select('trip_id::text,author_name,source_post_id,adopted_at').in('trip_id', ids.slice(start, start + 100));
    if (error) {
      if (error.code === 'PGRST205' || error.code === '42P01') return [];
      throw new Error('Community trip attribution could not be loaded. Please refresh.');
    }
    rows.push(...data as CommunityOrigin[]);
  }
  return rows;
}
