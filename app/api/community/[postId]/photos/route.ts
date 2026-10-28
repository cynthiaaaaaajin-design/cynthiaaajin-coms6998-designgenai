import { createClient } from '@/lib/supabase/server';
import { uuid } from '@/lib/community';

const json = (body: object, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
export async function GET(request: Request, { params }: { params: Promise<{ postId: string }> }) {
 const { postId } = await params;
 if (!uuid(postId)) return json({ error: 'Invalid trip.' }, 400);
 const client = await createClient();
 const page = Math.max(0, Math.min(10000, Number(new URL(request.url).searchParams.get('page')) || 0)) | 0;
 const { data, error } = await client.rpc('list_community_photos', { p_post_id: postId, p_page: page });
 if (error) return json({ error: 'Traveler photos are unavailable. Please try again later.' }, 503);
 const rows = await Promise.all(data.rows.map(async (row: { path: string }) => {
  const result = await client.storage.from('traveler-photos').createSignedUrl(row.path, 60);
  return { ...row, path: undefined, url: result.data?.signedUrl ?? null };
 }));
 return json({ rows, total: data.total });
}
export async function POST(request: Request, { params }: { params: Promise<{ postId: string }> }) {
 const { postId } = await params;
 if (!uuid(postId)) return json({ error: 'Invalid trip.' }, 400);
 if (request.headers.get('sec-fetch-site') === 'cross-site' || request.headers.get('origin') !== new URL(request.url).origin) return json({ error: 'Invalid request origin.' }, 403);
 const client = await createClient();
 const { data: { user } } = await client.auth.getUser();
 if (!user) return json({ error: 'Sign in to share your photos.' }, 401);
 try {
  if (request.headers.get('content-type')?.includes('multipart/form-data')) {
   if (Number(request.headers.get('content-length')) > 4.3 * 1024 * 1024) return json({ error: 'Choose an image up to 4 MB.' }, 400);
   const form = await request.formData(); const file = form.get('file'); const caption = form.get('caption');
   if (!(file instanceof File) || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size === 0 || file.size > 4 * 1024 * 1024 || typeof caption !== 'string' || caption.length > 300) return json({ error: 'Choose a JPG, PNG or WebP up to 4 MB and a caption up to 300 characters.' }, 400);
   const bytes = new Uint8Array(await file.arrayBuffer());
   const valid = file.type === 'image/jpeg' ? bytes[0]===255 && bytes[1]===216 && bytes[2]===255 : file.type === 'image/png' ? [137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b) : new TextDecoder().decode(bytes.slice(0,4))==='RIFF' && new TextDecoder().decode(bytes.slice(8,12))==='WEBP';
   if (!valid) return json({ error: 'The file contents do not match the image format.' }, 400);
   const ext = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';
   const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
   const uploaded = await client.storage.from('traveler-photos').upload(path, bytes, { contentType: file.type, upsert: false });
   if (uploaded.error) return json({ error: 'Upload failed. Please try again.' }, 503);
   const saved = await client.rpc('submit_community_photo', { p_post_id: postId, p_path: path, p_caption: caption });
   if (saved.error) { await client.storage.from('traveler-photos').remove([path]); return json({ error: saved.error.code==='22023' ? saved.error.message : 'Could not submit this photo.' }, 400); }
   return json({ success: true }, 201);
  }
  const raw = await request.text(); if (raw.length > 2000) return json({ error: 'Request too large.' }, 400);
  const body = JSON.parse(raw);
  if (!uuid(body.id) || !['caption','remove'].includes(body.action) || typeof body.caption !== 'string' || body.caption.length > 300) return json({ error: 'Invalid photo update.' }, 400);
  const { data: photo } = await client.from('community_photos').select('post_id').eq('id',body.id).maybeSingle();
  if (photo?.post_id !== postId) return json({ error: 'Photo unavailable.' }, 404);
  const result = await client.rpc('edit_community_photo', { p_id: body.id, p_action: body.action, p_caption: body.caption });
  return result.error ? json({ error: result.error.code==='22023' ? result.error.message : 'Only the uploader can change this photo.' }, 403) : json({ success: true });
 } catch { return json({ error: 'Could not process the photo. Check your file and try again.' }, 400); }
}
