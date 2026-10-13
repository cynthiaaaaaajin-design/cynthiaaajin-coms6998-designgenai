import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { validInviteToken } from '@/lib/invitations';
import { AuthButton } from '@/components/auth-buttons';
import { Header } from '@/components/header';
import { AcceptInvitation } from '@/components/accept-invitation';
export const metadata: Metadata = { title: 'Join a trip · TripSync', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function Invitation({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!validInviteToken(token)) notFound();
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return <><Header signedIn={!!user} /><main className="page-shell py-12"><section className="settings-card" style={{ maxWidth: 640, marginInline: 'auto', background: '#E4EFEB' }}>
    <p className="eyebrow">BETTER TOGETHER</p><h1 className="page-title">You’re invited.</h1>
    <p className="my-6">Join your friends’ private trip to view the itinerary, Like or Dislike activities, and share comments. It will also appear in Shared With Me.</p>
    {user ? <><p className="mb-4 text-sm">Signed in as {user.email}. Join using this account, or log out to switch accounts.</p><AcceptInvitation token={token} /></> : <><p className="mb-4 text-sm">New to TripSync? Continue with Google to create your account, then confirm joining the trip.</p><AuthButton next={`/invite/${token}`} /></>}
  </section></main></>;
}
