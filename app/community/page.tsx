import { ArrowIcon } from "@/components/arrow-icon";
import Link from 'next/link';
import { Header } from '@/components/header';
import { TripCoverArt } from '@/components/trip-cover-art';
import { createClient } from '@/lib/supabase/server';
import type { CommunityScore } from '@/lib/community';
export default async function Community({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const search = await searchParams;
  const q = typeof search.q === 'string' ? search.q.trim().slice(0, 100) : '';
  const page = Math.max(0, Math.min(10000, Number(search.page) || 0)) | 0;
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  let query = client.from('community_posts').select('id,title,destination,description,author_name,days,created_at', { count: 'exact' }).eq('status', 'published');
  if (q) query = query.ilike('destination', `%${q}%`);
  const { data, error, count } = await query.order('created_at', { ascending: false }).order('id').range(page * 12, page * 12 + 11);
  const scores = data?.length ? await client.rpc('community_scores', { p_ids: data.map(p => p.id) }) : { data: [], error: null };
  const scoreMap = Object.fromEntries(((scores.data ?? []) as CommunityScore[]).map(s => [s.post_id, s]));
  const pageHref = (p: number) => `/community?${new URLSearchParams({ q, page: String(p) })}`;
  return <><Header signedIn={!!user} active="community"/><main className="page-shell community-page">
    <div className="community-intro"><div><p className="eyebrow">THE COMMUNITY COLLECTION</p><h1>Good trips deserve<br/>to be shared<span>.</span></h1><p>Real travelers. AI-assisted itineraries. Find a little inspiration for your next escape.</p></div><Link className="button-primary" href={user ? '/trips' : '/?next=%2Ftrips'}>Share a trip <ArrowIcon /></Link></div>
    <div className="community-toolbar"><div><h2 className="text-xl font-semibold">Explore the collection</h2><p className="mt-1 text-sm text-slate-500">{error ? 'Collection unavailable' : `${count ?? 0} public itineraries`} · Newest first</p></div><form className="flex gap-2" action="/community"><label className="sr-only" htmlFor="destination-search">Search destinations</label><input id="destination-search" className="community-input" name="q" placeholder="Find a destination…" defaultValue={q}/><button className="button-secondary">Search</button></form></div>
    {error ? <div role="alert" className="notice">We couldn’t load Community. Please try again after setup is complete.</div> : !data?.length ? <div className="community-empty"><span><ArrowIcon size={36} /></span><h2>{q ? 'No trips here yet.' : 'Be the first to share a good trip.'}</h2><p>{q ? 'Try another destination or browse the full collection.' : 'Open one of your trips and publish its itinerary to Community.'}</p><Link className="button-secondary" href={q ? '/community' : '/trips'}>{q ? 'All destinations' : 'Go to my trips'}</Link></div> : <div className="community-grid">{data.map((p, i) => <Link className="community-card" key={p.id} href={`/community/${p.id}`}><div className={`community-card-art tone-${i % 3}`}><TripCoverArt destination={p.destination}/><span className="community-day-badge">{p.days} days</span></div><div className="community-card-body"><p className="eyebrow">{p.destination}</p><h3>{p.title}</h3><p className="community-card-description">{p.description || 'A day-by-day escape, planned with AI and shared by a traveler.'}</p><div className="community-card-footer"><span>By {p.author_name}</span><span>{scores.error ? 'Ratings unavailable' : `↑ ${scoreMap[p.id]?.upvotes ?? 0} · ↓ ${scoreMap[p.id]?.downvotes ?? 0}`}</span></div></div></Link>)}</div>}
    <nav aria-label="Community pages" className="community-pagination">{page > 0 && <Link className="button-secondary" href={pageHref(page - 1)}>← Previous</Link>}{(count ?? 0) > (page + 1) * 12 && <Link className="button-secondary" href={pageHref(page + 1)}>Next →</Link>}</nav>
  </main></>;
}
