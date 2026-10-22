# Week 6: setup and acceptance

Use the existing Supabase project, existing Google OAuth provider, and existing Google Places images. AI media here means generated textual itineraries.

## 1. Apply the database migration

Open Supabase → SQL Editor in the EXISTING TripSync project. Paste the entire contents of `week6-community-admin.sql` and run once as postgres. It adds community snapshot/vote tables, the protected superadmin flag and authenticated admin RPCs. It does not publish existing trips, modify original itineraries or widen private-trip access.

The admin repository contains the same migration. Run only ONE copy. All DDL is in a transaction; an error rolls back that attempt. If it errors, share the error before editing policies or rerunning fragments.

## 2. Bootstrap your administrator

Sign into the existing TripSync app with your chosen Google account first, then run this in SQL Editor, replacing the placeholder email:

```sql
update public.profiles p
set is_superadmin = true
from auth.users u
where p.id = u.id and lower(u.email) = lower('YOUR_GOOGLE_EMAIL')
returning p.id, p.first_name, p.is_superadmin;
```

Expect exactly one returned row with `is_superadmin = true`. No result means the account/profile has not been created, or the email differs. Ordinary app users cannot change this flag, including through direct profile API requests.

## 3. Deploy both repositories

The original repository continues to deploy the main TripSync app. The new `trypsync-admin` repository deploys a separate Next.js Vercel project. Use root directory `.` in each project.

Admin variables, using values from the SAME existing Supabase project:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `GEMINI_API_KEY` (server only)
- Optional `GEMINI_MODEL`, matching the working main app model.

No service-role key is required. Preserve the existing main-app variables, including Google Places keys. Admin uses no image-generation service.

Keep the main app's Supabase Site URL. In Authentication → URL Configuration add `http://localhost:3001/auth/callback`, the Admin production domain plus `/auth/callback`, and exact preview callback URLs used for the assignment. Local main-app testing here uses port 3010; add `http://localhost:3010/auth/callback` only if signing into that test instance. Keep Google's provider callback pointing to Supabase, as before.

After deployment, disable Vercel Deployment Protection for BOTH apps. The admin application's own Google login + database role checks must remain active. Submit both latest commit-specific deployment URLs.

## 4. Acceptance checks

- Anonymous: `/community` and a published detail are visible; original private trips still require membership.
- Author: publish latest saved itinerary, view its snapshot, update it explicitly, then withdraw it. Group members, travel dates, preferences, prompts, invitations and private feedback never appear in the snapshot. Deleting the original trip also removes its Community snapshot and Community votes. Activity text itself is public; review it before publishing.
- Different user: vote, change vote, remove vote. Each user has one vote per publication. Private trip activity votes remain separate.
- Admin routes: visit `/overview`, `/users`, `/media`, `/media/new`, `/media/<id>` and `/ratings` while signed out. Each redirects to login. An ordinary Google account is denied after sign-in.
- Admin: create an AI itinerary preview, save a draft, edit it, publish it, hide it, and permanently delete it. Deleted snapshots and their Community votes disappear; the private source trip stays intact.
- A hidden publication cannot be republished by its author. Admin can release it by changing its status.
- Users are searchable/read-only. Both Community votes and private activity votes/comments are readable in their respective tabs.
- Remove the admin flag in SQL Editor and verify future admin requests/actions are denied.

## Local verification

`npm run test:week6` runs isolated Postgres-compatible RLS/RPC tests with PGlite and mocked OAuth redirect tests. It does not change the live database. Run lint and production build in both repositories. The Admin repository also has `npm run test:security`.
