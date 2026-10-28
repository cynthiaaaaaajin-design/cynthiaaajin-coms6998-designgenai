import { createClient } from '@/lib/supabase/server';
import { uuid } from '@/lib/community';
import { destinationPhoto } from '@/lib/google-places';
import { destinationStops } from '@/lib/destinations';
export const maxDuration = 20;
export async function GET(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  const index = Number(new URL(request.url).searchParams.get('index') ?? 0);
  const json = (photo: unknown, status = 200, count = 0) => Response.json({ photo, count }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  if (!uuid(postId) || !Number.isInteger(index) || index < 0 || index > 4) return json(null, 400);
  try {
    const client = await createClient();
    const { data, error } = await client.from('community_posts').select('destination').eq('id', postId).eq('status', 'published').maybeSingle();
    if (error || !data) return json(null, 404);
    const stops = destinationStops(data.destination).slice(0, 5);
    if (stops.length > 1) {
      if (index >= stops.length) return json(null, 400, stops.length);
      const photo = await destinationPhoto(stops[index], 0);
      return json(photo ? { ...photo, count: stops.length } : null, 200, stops.length);
    }
    const photo = await destinationPhoto(stops[0] ?? '', index);
    return json(photo, 200, photo?.count ?? 0);
  } catch { return json(null); }
}
