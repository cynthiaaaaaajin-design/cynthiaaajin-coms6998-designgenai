# TripSync

Plan trips together, without the group chat chaos.

Next.js App Router + Tailwind CSS + Supabase Google OAuth. The homepage, profile/settings page, and protected `/trips` dashboard are implemented. The dashboard reads the signed-in user’s trips from Supabase. Only the homepage preview uses an explicitly labeled sample trip; collaboration and trip CRUD are future features.

## Run locally

```sh
npm install
npm run dev
```

Keep the existing `.env.local` values for `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Do not add a service-role key. Open http://localhost:3000.

```sh
npm run lint
npm run build
# Alternative if this machine blocks Turbopack worker ports:
npm run build -- --webpack
```

## Existing infrastructure and manual checks

No database changes have been applied. The existing `movies` and `trips` tables, profile trigger, avatars bucket, Supabase project, and Vercel project are preserved.

The app expects `public.profiles.id` to match `auth.users.id` (UUID), plus nullable text `first_name`, `last_name`, and `avatar_url`. Verify the existing schema before applying any SQL or changing this mapping. The existing trigger is the only profile creator; the app updates existing rows and reports a missing row rather than inserting one.

The dashboard uses the existing `trips` columns `id`, `title`, `destination`, `start_date`, `end_date`, `created_at`, and `user_id`. Column existence was verified using zero-row REST queries; no trip records were read or changed. It filters `user_id` by the verified signed-in user and orders the returned rows by `start_date` ascending. Verify trips RLS also restricts reads to the appropriate user. Shared membership is not assumed because no membership schema was provided. No schema change is needed for this dashboard.

1. In Supabase → Authentication → URL Configuration, retain/set your production Site URL and allow these exact app callback URLs:
   - `http://localhost:3000/auth/callback`
   - `https://YOUR-EXISTING-VERCEL-DOMAIN/auth/callback`
   - Any preview domain you actually test, ending in `/auth/callback`.
2. Keep the existing Google provider configuration. Google's authorized redirect URI remains the Supabase provider callback (`https://YOUR-PROJECT.supabase.co/auth/v1/callback`). That is distinct from this app's `/auth/callback`, which exchanges the code then redirects to `/profile`.
3. Verify RLS permits authenticated users to read/update only their own profile. Check existing policies before adding anything. A client-side `.eq("id", user.id)` does not replace RLS.
4. Verify Storage policies allow upload/read/delete inside `avatars/<user-id>/`. Upload uses a fresh UUID filename, with no overwrite. Reads use signed URLs; a private bucket is supported. DELETE is used for best-effort cleanup if a profile update fails after an upload. Existing successful avatar versions are retained to avoid deleting referenced files.
5. In the existing avatars bucket, recommended server-enforced restrictions are 5 MB and MIME types `image/jpeg`, `image/png`, `image/webp`. The UI validates these too; bucket rules enforce them for direct API requests.
6. In the existing Vercel project, verify both existing public environment variables are set for the environments you deploy. Deploy this repository through that same project; redeploy after environment changes. No new project is required.

### Optional policy SQL — review first; not applied

No table/column/trigger changes are needed if the described schema exists. If access policies are missing, the following is a **proposal for manual review**, not a migration. Inspect existing policies (including broad permissive policies) first: policies combine, so adding a restrictive condition here does not narrow an existing broad grant. Do not run duplicate policies.

```sql
-- Read-only inspection first:
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where (schemaname = 'public' and tablename = 'profiles')
   or (schemaname = 'storage' and tablename = 'objects');

-- Only if equivalent profile policies are missing:
alter table public.profiles enable row level security;
create policy "TripSync read own profile"
on public.profiles for select to authenticated
using ((select auth.uid()) = id);
create policy "TripSync update own profile"
on public.profiles for update to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

-- Only if equivalent Storage policies are missing:
create policy "TripSync upload own avatar"
on storage.objects for insert to authenticated
with check (bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "TripSync read own avatar"
on storage.objects for select to authenticated
using (bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "TripSync clean up own avatar"
on storage.objects for delete to authenticated
using (bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text);
```

Why these policies: the publishable-key client acts as the signed-in user. Profile reads/updates and Storage uploads/signed reads require authorization. No profile INSERT policy is needed by this app because the existing trigger inserts the row. No Storage UPDATE policy is required because uploads never overwrite objects. If table privileges were previously revoked, also review the existing authenticated-role grants rather than granting broad access blindly.

References: [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/nextjs), [Storage access policies](https://supabase.com/docs/guides/storage/security/access-control).

## Exact acceptance test

1. **Protected access:** Start `npm run dev`. In a fresh private browser window visit `http://localhost:3000/trips`. Expect a redirect to `/`, without trip content. `/profile` also redirects home.
2. **Google login:** Click **Continue with Google**, complete Google consent, and observe the return through `/auth/callback` to `/profile`. Refresh `/profile`; you should remain signed in. Cancel consent once to verify the homepage displays a retry message.
3. **Profile creation:** Use a Google account that has never signed into this Supabase project. In Supabase Authentication, find its user UUID. In Table Editor → profiles, verify exactly one row has that ID. This row comes from the existing trigger. If either name is null/empty, the profile page must show **Let’s complete your profile**. If your trigger populates both names, this prompt correctly does not appear. An existing account does not fire the new-user trigger again.
4. **Names:** Enter first and last names; click **Save changes**. Expect success and removal of the completion prompt. Refresh and verify the same values in both UI and the profile row. Test spaces-only names: saving must fail with a clear prompt.
5. **Photo:** Choose a JPG, PNG, or WebP under 5 MB. In the crop modal, drag the image and adjust the zoom slider. Click **Cancel** once and confirm the existing avatar is unchanged; select the same image again, adjust the circular crop, then click **Use photo**. The preview updates immediately and the cropped photo is uploaded without requiring the name fields to be saved. Verify the photo appears after refresh. In Storage → avatars, find `<user-id>/<uuid>.<extension>`. In profiles, verify `avatar_url` stores only that path, never binary data or an expiring signed URL. Try an oversized image; expect rejection. Sign out and back in to verify the saved photo remains accessible.
6. **Signed-in dashboard:** Visit `/trips` while signed in; expect the TripSync dashboard. Existing rows whose `user_id` matches this account should show their actual title, destination, and dates. Compare with Table Editor. If the account has no visible trips, expect the empty state, not sample cards. Reload and confirm access remains. If you need a test fixture, manually add a row using the existing table’s required fields and your user UUID; this is test data, not a schema change. If trips fail to load, check the existing SELECT policy and grants. Trip creation/editing UI is outside this assignment’s route requirement.
7. **Logout:** Click **Log out**. Expect `/` with Google login available. Visit `/trips` and refresh: expect a redirect home. Logout ends this browser's Supabase session; it does not log you out of Google or other devices.
8. **Isolation:** With a second account, verify its profile and trips are separate. Its dashboard must not show the first account’s trips; also verify RLS denies direct API reads of those rows. Check that its authenticated Supabase client cannot read/update another user's profile or upload to another user's avatar folder. Test private Storage reads with that second account if the bucket is private.

Google consent and authenticated database/storage operations require a real account and the existing deployed project's policies, so build/lint checks alone do not verify them.

## File map

- `app/page.tsx`: TripSync landing page, Google entry point, OAuth error message.
- `app/layout.tsx`: product metadata and system typography (no build-time font download).
- `app/globals.css`: responsive travel UI, cards, forms, and focus states.
- `app/auth/callback/route.ts`: OAuth code exchange, fixed `/profile` redirect, explicit no-store response headers.
- `app/profile/page.tsx`: server auth check, profile query, signed avatar URL.
- `app/profile/profile-form.tsx`: validated names, crop-before-upload flow, immediate photo preview, and independent avatar persistence.
- `app/trips/page.tsx`: server-protected dashboard querying the current user’s trips, with empty/error states.
- `components/avatar-crop-modal.tsx`: responsive native dialog, circular react-easy-crop mask, drag/zoom controls, and 512×512 JPEG crop generation.
- `components/auth-buttons.tsx`: Google login and current-browser logout.
- `components/header.tsx`: shared branding/navigation.
- `components/trip-card.tsx`: illustrated sample card for the homepage preview.
- `components/saved-trip-card.tsx`: real trip cards with null-safe labels and UTC date formatting.
- `scripts/verify-public-routes.mjs`: repeatable signed-out route smoke tests.
- `lib/supabase/config.ts`: existing public environment variable validation.
- `lib/supabase/client.ts`: SSR-compatible browser client.
- `lib/supabase/server.ts`: per-request cookie-based server client.
- `proxy.ts`: session refresh and no-store responses.
- `lib/supabase.ts`: removed; migrated from shared client to the clients above.
- `README.md`: setup, optional policy SQL, and acceptance tests.

The pre-existing uncommitted `package.json` / `package-lock.json` changes already provided both Supabase packages and were preserved.


## Verification completed without OAuth login

- `npm run build`: passed with the standard Turbopack build (includes TypeScript).
- `npm run lint`: passed, no errors or warnings.
- Production-server smoke tests: all six checks passed (homepage; signed-out profile/trips redirects; missing/cancelled callback redirects; retry message). Auth-related responses were checked for `no-store`.
- `git ls-files -- .env.local`: no output; the file is not tracked. `git check-ignore .env.local`: confirms it is ignored by `.env*`.
- Read-only Supabase queries verified trips table access and required column existence. RLS behavior for authenticated users still needs the account tests above.
- No schema, policy, trigger, bucket, or remote data changes were made.

To repeat the public-route smoke checks, start the app in one terminal, then run in another:

```sh
npm run build
npm run start
# In another terminal:
node scripts/verify-public-routes.mjs http://localhost:3000
```

Still requires a real login: successful code exchange/cookie persistence, trigger-created row, name update persistence, avatar upload and signed image display, authenticated trips data/RLS isolation, session refresh, and logout. Follow the acceptance checklist above. A build passing does not establish these account-dependent results.


Avatar crop checks: test portrait and landscape images, mouse dragging, touch/pinch, zoom slider, arrow-key repositioning, Escape/Cancel, selecting the same file again, oversized/unsupported files, and a failed upload followed by retry. Only confirmed crops are uploaded. The 512×512 square JPEG is displayed through the circular avatar mask; Postgres stores only its Storage path. Crop/source object URLs are released when replaced or closed.

Profile lookup diagnostics: `app/profile/page.tsx` logs the exact Supabase `message`, `code`, `details`, and `hint` on the server when the lookup fails. A successful query with no row has a separate warning. View the local server terminal or Vercel runtime logs. Profile queries continue to filter `profiles.id`, while trip queries filter `trips.user_id`.


Trips query diagnostics: `/trips` selects all columns from `trips`, filters `user_id` using `supabase.auth.getUser()`’s user ID, and sorts by `start_date` ascending. Server logs include `[trips] Query result` with `userId` and `tripsReturned`. On failure, `[trips] Query failed` includes Supabase’s exact `message`, `code`, `details`, and `hint`. Check the local Next.js terminal or Vercel runtime logs after refreshing `/trips`.
