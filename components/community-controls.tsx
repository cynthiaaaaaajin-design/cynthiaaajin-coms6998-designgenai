'use client';
import { ArrowIcon } from "@/components/arrow-icon";
import Link from 'next/link';
import { useActionState } from 'react';
import { publishTrip, ratePost } from '@/app/community/actions';
import type { CommunityScore } from '@/lib/community';
export function PublicationControls({ tripId, post, unavailable }: { tripId: string; post: { id: string; status: string; description: string } | null; unavailable: boolean }) {
  const [state, action, pending] = useActionState(publishTrip, {});
  return <details className="community-publish settings-card mt-6"><summary><ArrowIcon /> Share this itinerary with Community <span className="pill">{post?.status === 'published' ? 'Public snapshot' : 'Private trip'}</span></summary>
    <p className="mt-4 text-sm leading-6 text-slate-600">Publish a separate copy of your latest saved itinerary. Its title, destination, activities and your first name will be visible to everyone. Group members, preferences, dates, feedback and invitation links stay private. Review activity text for personal details before publishing.</p>
    {unavailable ? <p className="notice mt-4" role="alert">Community publishing is not available yet. Please try again after setup is complete.</p> : post?.status === 'hidden' ? <p className="notice mt-4">An administrator has hidden this publication. Contact the administrator before publishing again.</p> : <form action={action} className="mt-4">
      <input type="hidden" name="tripId" value={tripId} />
      <label className="block text-sm font-semibold">A note for other travelers<textarea name="description" maxLength={2000} defaultValue={post?.description ?? ''} className="community-input mt-2" placeholder="What makes this itinerary worth sharing?" /></label>
      <div className="mt-4 flex flex-wrap gap-3"><button className="button-primary" name="mode" value="publish" disabled={pending}>{pending ? 'Saving…' : post ? 'Publish latest version' : 'Publish to Community'}</button>
      {post?.status === 'published' && <><button className="button-secondary" name="mode" value="withdraw" disabled={pending}>Withdraw publication</button><Link className="button-secondary" href={`/community/${post.id}`}>View public plan <ArrowIcon /></Link></>}</div>
    </form>}
    <p role={state.error ? 'alert' : 'status'} className={`mt-3 text-sm ${state.error ? 'text-red-700' : 'text-teal-800'}`}>{state.error ?? state.success}</p>
  </details>;
}
export function CommunityVoting({ id, score, signedIn }: { id: string; score: CommunityScore; signedIn: boolean }) {
  const [state, action, pending] = useActionState(ratePost, {});
  return <section className="community-rating"><div><p className="eyebrow">TRAVELER VERDICT</p><h2 className="mt-2 text-xl font-semibold">Would you take this trip?</h2><p className="mt-2 text-sm text-slate-500">One vote per traveler. Select your vote again to remove it.</p></div>
    {signedIn ? <form action={action} className="flex flex-wrap gap-3"><input type="hidden" name="postId" value={id}/><button className="button-secondary" aria-pressed={score.mine === 1} name="value" value={score.mine === 1 ? 0 : 1} disabled={pending}>↑ Yes · {score.upvotes}</button><button className="button-secondary" aria-pressed={score.mine === -1} name="value" value={score.mine === -1 ? 0 : -1} disabled={pending}>↓ Not for me · {score.downvotes}</button></form> : <p className="text-sm">↑ {score.upvotes} · ↓ {score.downvotes}<br/><Link className="text-teal-800 underline" href={`/?next=${encodeURIComponent(`/community/${id}`)}`}>Sign in with Google to vote</Link></p>}
    <p className="text-sm" role={state.error ? 'alert' : 'status'}>{state.error ?? state.success}</p>
  </section>;
}
