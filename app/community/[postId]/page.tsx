import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '@/components/header';
import { CommunityPhoto } from '@/components/community-photo';
import { CommunityVoting } from '@/components/community-controls';
import { createClient } from '@/lib/supabase/server';
import { publicPostFields, uuid, type CommunityPost } from '@/lib/community';
export default async function PublicPlan({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  if (!uuid(postId)) notFound();
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  const { data, error } = await client.from('community_posts').select(publicPostFields).eq('id', postId).eq('status', 'published').maybeSingle();
  if (error) throw new Error('Community could not be loaded. Please try again.');
  if (!data) notFound();
  const post = data as CommunityPost;
  const { data: scores, error: scoreError } = await client.rpc('community_scores', { p_ids: [postId] });
  return <><Header signedIn={!!user} active="community"/><main className="page-shell community-page community-detail"><Link href="/community" className="text-sm text-teal-800">← Back to Community</Link>
    <div className="community-detail-heading"><div><p className="eyebrow">{post.destination} · {post.days} DAYS</p><h1>{post.title}</h1><p className="text-slate-500">Shared by {post.author_name} · AI-assisted itinerary</p><p className="mt-5 whitespace-pre-wrap leading-7">{post.description}</p></div><CommunityPhoto id={post.id} destination={post.destination}/></div>
    <p className="notice">A public snapshot for inspiration. Check opening hours, prices and availability before traveling.</p>
    {Array.from({ length: post.days }, (_, i) => i + 1).map(day => <section className="community-day" key={day}><p className="eyebrow">DAY {String(day).padStart(2, '0')}</p><ol>{post.activities.filter(a => a.day_number === day).map(a => <li key={`${day}:${a.position}`}><time>{a.start_time || 'Flexible'}</time><div><h3>{a.title}</h3><p className="text-sm text-teal-800">{a.location}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{a.description}</p></div></li>)}</ol></section>)}
    {scoreError ? <p className="notice" role="alert">Ratings are temporarily unavailable.</p> : <CommunityVoting id={postId} signedIn={!!user} score={scores?.[0] ?? { post_id: postId, upvotes: 0, downvotes: 0, mine: null }}/>}
  </main></>;
}
