# Trip invitation deployment

1. In the Supabase project used by TripSync, run `sql/trip-invitations.sql` once in SQL Editor as postgres. It creates only the invitation table and two restricted RPC functions; existing table RLS stays unchanged. The app does not automatically run SQL migrations.
2. Deploy the application commit. No additional environment variable, email provider, or service-role key is needed. Existing Google OAuth redirect URLs must already allow the app origin's `/auth/callback`.
3. As the owner, use Share trip → Create invitation link, and copy the link. A new link invalidates the previous one. No email is sent.
4. Open the link in a separate signed-out browser, continue with Google using a new user, and press Join shared trip. Verify the itinerary opens and the dashboard lists it under Shared With Me. The existing auth signup trigger must create the user's profiles row.
5. Verify a member cannot create/revoke links or generate/revise/delete the trip. Verify outsider access via `/trips/<id>` still fails.
6. Verify repeated acceptance adds no duplicate member; revoke the link and confirm a different user cannot accept it. In a disposable test trip, set expiry to the past as the database owner and verify rejection.
7. Verify concurrent regeneration/revocation and acceptance are serialized; whoever obtains the trip lock first completes first. Check signed-out retry after OAuth failure and member removal.

Anyone possessing an active invitation may join with a verified signed-in account. To prevent a removed traveler rejoining via a link they already know, revoke or replace that link as well. Revoking invitations does not remove existing members.

Automated local checks mock Supabase; they do not replace the SQL/live multi-user checks above. Token hashes are private; only the freshly issued raw link is returned to its owner. Invite pages are noindex/no-referrer and mutation responses are private/no-store. Do not publish invitation URLs in analytics or logs.
