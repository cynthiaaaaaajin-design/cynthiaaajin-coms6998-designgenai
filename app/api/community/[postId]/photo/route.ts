import { createClient } from '@/lib/supabase/server';
import { uuid } from '@/lib/community';
import { destinationPhoto } from '@/lib/google-places';
export const maxDuration = 20;
export async function GET(_request: Request, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  const json = (photo: unknown, status = 200) => Response.json({ photo }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  if (!uuid(postId)) return json(null, 400);
  try {
    const client = await createClient();
    const { data, error } = await client.from('community_posts').select('destination').eq('id', postId).eq('status', 'published').maybeSingle();
    if (error || !data) return json(null, 404);
    return json(await destinationPhoto(data.destination, 0));
  } catch { return json(null); }
}
