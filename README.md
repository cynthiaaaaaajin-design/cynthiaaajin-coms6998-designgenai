# TripSync

Plan trips together, without the group chat chaos.

Next.js App Router + Tailwind CSS + Supabase Google OAuth. The homepage, profile/settings page, and protected `/trips` dashboard are implemented. The dashboard shows owned and privately shared trips from Supabase. Trip detail pages support owner-only Gemini itinerary generation and revision, version history, authenticated Like/Dislike/comment feedback, and owner-managed travelers through `trip_members`. Sharing depends on the existing RLS permissions described below. Only the homepage preview uses a labeled sample trip. Authenticated users can create private trips at `/trips/new`; manual itinerary editing is not implemented.

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

The dashboard reads `id`, `user_id`, `title`, `destination`, `start_date`, and `end_date` from existing `trips` rows, plus the signed-in user's `trip_members` rows. It uses paginated reads under the user's Supabase session, explicitly retains only owned/member trips, and sorts them by start date with missing dates last. Bigint trip IDs are read as text. RLS must independently enforce private access; application filtering does not replace database policies. No schema change is needed for this dashboard.

1. In Supabase → Authentication → URL Configuration, retain/set your production Site URL and allow these exact app callback URLs:
   - `http://localhost:3000/auth/callback`
   - `https://YOUR-EXISTING-VERCEL-DOMAIN/auth/callback`
   - Any preview domain you actually test, ending in `/auth/callback`.
2. Keep the existing Google provider configuration. Google's authorized redirect URI remains the Supabase provider callback (`https://YOUR-PROJECT.supabase.co/auth/v1/callback`). That is distinct from this app's `/auth/callback`, which exchanges the code, then returns to an intended trip or routes complete profiles to `/trips` and incomplete profiles to `/profile`.
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
2. **Google login:** Click **Continue with Google**, complete Google consent, and observe the return through `/auth/callback` to `/trips` for a complete profile or `/profile` for an incomplete profile. A shared-trip link takes priority and returns to that trip. Refresh `/profile`; you should remain signed in. Cancel consent once to verify the homepage displays a retry message.
3. **Profile creation:** Use a Google account that has never signed into this Supabase project. In Supabase Authentication, find its user UUID. In Table Editor → profiles, verify exactly one row has that ID. This row comes from the existing trigger. If either name is null/empty, the profile page must show **Let’s complete your profile**. If your trigger populates both names, this prompt correctly does not appear. An existing account does not fire the new-user trigger again.
4. **Names:** Enter first and last names; click **Save changes**. Expect success and removal of the completion prompt. Refresh and verify the same values in both UI and the profile row. Test spaces-only names: saving must fail with a clear prompt.
5. **Photo:** Choose a JPG, PNG, or WebP under 5 MB. In the crop modal, drag the image and adjust the zoom slider. Click **Cancel** once and confirm the existing avatar is unchanged; select the same image again, adjust the circular crop, then click **Use photo**. The preview updates immediately and the cropped photo is uploaded without requiring the name fields to be saved. Verify the photo appears after refresh. In Storage → avatars, find `<user-id>/<uuid>.<extension>`. In profiles, verify `avatar_url` stores only that path, never binary data or an expiring signed URL. Try an oversized image; expect rejection. Sign out and back in to verify the saved photo remains accessible.
6. **Signed-in dashboard:** Visit `/trips` while signed in; expect the TripSync dashboard. Owned trips and trips shared through `trip_members` should show their actual title, destination, and dates; each card opens `/trips/[tripId]`. Compare with Table Editor. If the account has no visible trips, expect the empty state, not sample cards. Reload and confirm access remains. If you need a test fixture, manually add a row using the existing table’s required fields and your user UUID; this is test data, not a schema change. If trips fail to load, check the existing SELECT policy and grants. Use “+ Plan a new trip” to create a private trip; editing existing trip details is not implemented.
7. **Logout:** Click **Log out**. Expect `/` with Google login available. Visit `/trips` and refresh: expect a redirect home. Logout ends this browser's Supabase session; it does not log you out of Google or other devices.
8. **Isolation:** With a second account, verify its profile and trips are separate. Its dashboard must not show the first account’s private trips unless explicitly shared through `trip_members`; verify RLS denies direct API reads by nonparticipants. Check that its authenticated Supabase client cannot read/update another user's profile or upload to another user's avatar folder. Test private Storage reads with that second account if the bucket is private.

Google consent and authenticated database/storage operations require a real account and the existing deployed project's policies, so build/lint checks alone do not verify them.

## File map

- `app/page.tsx`: TripSync landing page, Google entry point, OAuth error message.
- `app/layout.tsx`: product metadata and system typography (no build-time font download).
- `app/globals.css`: responsive travel UI, cards, forms, and focus states.
- `app/auth/callback/route.ts`: OAuth code exchange, validated trip destination and profile-aware redirect, explicit no-store response headers.
- `app/profile/page.tsx`: server auth check, profile query, signed avatar URL.
- `app/profile/profile-form.tsx`: validated names, crop-before-upload flow, immediate photo preview, and independent avatar persistence.
- `app/trips/page.tsx`: server-protected dashboard listing owned/member trips, with empty/error states.
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

- `npm run build -- --webpack`: production build including TypeScript verification. Use the commands below to repeat the checks on the current checkout.
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


Trips query diagnostics: `/trips` uses `loadPrivateTrips` in `lib/travelers-server.ts` to read memberships and RLS-visible trips, then applies explicit owner/member filtering and start-date sorting. Server logs include `[trips] Query result` with `projectHost`, `userId`, `tripsReturned`, and `querySucceeded`. On failure, `[trips] Query failed` includes the loader's error message. Check the local Next.js terminal or Vercel runtime logs after refreshing `/trips`.

## Assignment 4: initial AI itinerary generation

Open an owned trip from `/trips`, then complete the form on `/trips/[tripId]`.
Budget and interests are required; things to avoid and instructions are optional.
Trips need a destination and valid inclusive dates, with a maximum of 30 days.

`POST /api/trips/[tripId]/generate` verifies the Supabase user and trip ownership,
checks for existing versions, and calls the official `@google/genai` SDK only on
the server. Set `GEMINI_API_KEY` in `.env.local` and in the existing deployment's
server environment. Optional `GEMINI_MODEL` overrides the default
`gemini-3.8-flash`. Neither variable uses the `NEXT_PUBLIC_` prefix. The SDK call
uses JSON Schema output, a 90-second timeout, and a single attempt. The hosting
plan must support the route's 120-second maximum duration.

Before calling Gemini, the route inserts an `itinerary_versions` row with the
exact `contents` prompt in `prompt_text`, version 1, `ai_initial`, the verified
creator, and the trip ID. If this insert fails, Gemini is not called. The database
supplies `created_at`. The route then completes only that new row's `response_text`:
success stores the original model text; failure stores JSON with `response_text`
(the returned text, or null) and sanitized error details. Output is captured before
validation, including malformed or truncated output. Successful activities are
bulk-inserted with `version_id` and `origin = ai`. Earlier versions remain untouched.

No schema or RLS changes are included. Existing policies must allow the owner to
SELECT their trip/versions/items, INSERT their version/items, and UPDATE their
new version's response. Live UPDATE permissions still require verification.
All requests use the user's session and publishable key, never a service-role key.
A denied/zero-row response update returns an explicit persistence error; the prompt
remains saved, but the response cannot be guaranteed if that write fails.
A process interruption after the prompt insert can likewise leave a null response.

Failed attempts consume a version number and may have no activities. Owners can
use **Repair itinerary** on an empty AI version, including one selected from history.
The repair endpoint validates saved response text first (including older error
wrappers), or calls Gemini with the exact saved prompt if no valid response exists.
It checks the exact visible item count before work and again before inserting into
the same version. It never upserts/deletes items or changes version metadata.
The existing unique `(version_id, day_number, position)` constraint and required
initial slot reject colliding repair inserts. A regenerated response is saved only
after the recovery insert succeeds; a response-update failure is logged while the
restored items remain usable. Owner SELECT visibility must be correct: an RLS-hidden
row is not proof of missing data. Diagnose visibility before using repair for a
production-only empty display. Earlier successful versions remain accessible through history. If saving activities fails, the prompt
and response remain saved. Manual editing is not implemented.

Local verification:

```sh
node scripts/verify-itinerary.mjs
npm run lint
npm run build
```

The itinerary script uses mocked database and Gemini adapters; it does not make
network requests or modify Supabase. It covers validation, owner authorization,
existing-version preservation, exact prompt/response persistence, bulk item
insertion, bigint route IDs, and failure paths. It also checks that the prompt is saved before Gemini is called, failed prompt inserts prevent the call, malformed/truncated output is captured before validation, secrets are redacted from saved diagnostics, and denied/zero-row response updates return an explicit error.

Manual end-to-end checks (require a real account and existing trip):

1. Run `npm run dev`, sign in with Google, and open a trip you own from `/trips`.
   Confirm title, destination, and start/end dates.
2. For a trip with no versions and valid dates, enter a budget with currency,
   interests, things to avoid, and optional instructions. Click **Generate
   itinerary with AI**. Confirm the button disables and a loading message appears.
3. After success, confirm day sections, times, titles, descriptions, and locations
   appear. Refresh and confirm the same itinerary remains and the form is absent.
4. In Supabase Table Editor, inspect the new version: `version_number = 1`,
   `source = ai_initial`, the correct trip and creator, an exact assembled prompt
   containing every input, the original JSON response, and a creation timestamp.
5. Inspect `itinerary_items`: every generated activity references that version,
   has `origin = ai`, and matches the response content and ordering.
6. POST to the generation endpoint again while signed in. Expect the existing
   version ID, no new Gemini call, and no new database rows.
7. Sign out: opening the detail page redirects home and POST returns 401. With a
   second account that is not a member, the detail page is unavailable and POST
   returns 404 for the first account's trip. A trip member can read the detail
   page and submit feedback, but cannot generate an itinerary.
8. Submit invalid/empty preferences or use a trip with invalid/missing dates.
   Expect a clear validation error and no inserts. Temporarily unset
   `GEMINI_API_KEY` locally and restart: a new trip's generation should show a
   generic generation error with category `missing_api_key`. The attempt’s exact prompt and sanitized error are saved in a new version, with no activities (provided existing version UPDATE permissions allow saving the error). Restore the environment value. Use a disposable test trip: the empty version remains saved and the owner can use Repair itinerary after restoring configuration.
9. Check browser network requests: the browser calls only the application's
   generation endpoint, and its payload contains preferences, never the API key.
   Partial-save and provider-error behavior can be tested safely with the local
   mock script rather than changing live RLS policies.


## Assignment 4: authenticated activity feedback

Each current itinerary item displays Like/Dislike counts, your latest vote and
comment, and a feedback form. The trips dashboard includes shared trips visible
through existing RLS. The detail page additionally checks that the viewer is the
owner or has a `trip_members` row. Only the owner can generate an itinerary.

`POST /api/trips/[tripId]/votes` accepts `item_id`, `value` (1 or -1), and an
optional comment of at most 2,000 characters. The server gets the voter ID from
`supabase.auth.getUser()`, checks trip access/membership, and verifies that the
item belongs to the highest-numbered itinerary version for that trip. It then
INSERTs one row into `activity_votes` using the authenticated user's Supabase
session. Client-provided user IDs are ignored. There are no UPDATE, DELETE, or
upsert operations on votes, and no automatic submission retries.

The display groups rows by `(item_id, user_id)` and uses the highest vote ID for
each group. Repeated Likes count once; changing to Dislike moves that user's
single current contribution. The same latest row supplies the displayed comment.
An empty comment on a later vote clears the displayed comment while preserving
the historical row. IDs are selected as text and compared as bigint. Cursor
pagination reads beyond Supabase's per-query row limit, without offset shifts
when new votes arrive.

The form immediately updates from the server's response after a confirmed save,
then refreshes server data. A failed save leaves the saved counts unchanged and
preserves the draft. If the insert succeeds but the summary cannot be read, the
UI reports that feedback was saved and counts are unavailable; it does not claim
the insert failed or silently insert again. Other participants see changes when
they refresh; live subscriptions are outside this feature.

No database schema or RLS changes are included. Existing policies must allow
participants to read the trip/current version/items and the trip's feedback rows,
and insert votes with their own user ID. The app does not bypass policies. If
SELECT policies hide other participants' feedback, those rows cannot contribute
to the displayed totals. Direct database append-only enforcement remains the
responsibility of existing grants/RLS; this application only inserts votes.

Verification:

```sh
node scripts/verify-feedback.mjs
node scripts/verify-itinerary.mjs
npm run lint
npm run build -- --webpack
```

Feedback manual tests (use existing trips and memberships):

1. Sign in as the owner and open a trip with a generated itinerary. On each item,
   confirm counts, Like/Dislike buttons, the optional comment, and Submit feedback.
2. Choose Like, enter `Looks great`, and submit. Confirm the saving state, then
   the Like count and your latest vote/comment update without a manual reload.
3. In Supabase Table Editor, confirm one new `activity_votes` row references that
   item, has your authenticated UUID, `value = 1`, and the comment. Refresh the
   trip and confirm the same display.
4. Change that item to Dislike with `Prefer a quieter place`. Submit and confirm
   another row is inserted, the original row remains unchanged, and your current
   contribution moves from Like to Dislike rather than counting twice.
5. Submit Dislike again with no comment. A third row should appear; counts remain
   unchanged and your latest displayed comment disappears. Old comments remain
   in the earlier rows.
6. Sign in as an existing trip member in a separate browser. Open the shared trip,
   submit Like, and confirm counts reflect both users' latest choices. Each user
   sees their own latest comment. Refresh the owner's page to see the member's
   feedback. The member must not see generation controls on an empty trip.
7. Sign out and POST to the votes endpoint: expect 401. As a signed-in nonmember,
   attempt the trip URL and POST: expect denied access and no inserted row.
8. Send an invalid value, an overlong comment, or an item ID from a different trip
   or an older version: expect a validation/access error and no new vote row.
   The mock test also confirms a forged `user_id` cannot impersonate another user.
9. Run the mock script to test denied inserts, failed summary reads after a save,
   pagination, and bigint ordering without changing live policies or data.


## Assignment 4: revise with group feedback

On the current itinerary, the owner can click **Revise with group feedback**.
The route `POST /api/trips/[tripId]/revise` verifies the signed-in owner, reads the
latest version and its items, and uses the shared paginated vote reader. For each
`(item_id, user_id)`, only the highest vote ID contributes a Like/Dislike and a
comment. Superseded comments are not sent to Gemini. No voter UUIDs are included
in the prompt.

The revision prompt includes the trip destination/dates, the entire previous
itinerary with per-activity feedback counts and latest comments, and the earliest
`ai_initial` row's exact prompt. That original prompt preserves budget, interests,
things to avoid, and optional instructions without adding columns or recursively
embedding previous revision prompts. The model is told to preserve well-liked
activities where appropriate, improve/replace disliked activities, and respect
original constraints. Comments and embedded prompts are explicitly treated as
traveler data, not instructions to change the response format.

The existing server-only Gemini helper still requests and validates structured
JSON. Before the call, the exact revision prompt is INSERTed
into a new `itinerary_versions` row with `source = ai_revision`, the authenticated
owner, `version_number = previous.version_number + 1`, and
`parent_version_id = previous.id`. New items are bulk-inserted with that new
version ID and `origin = ai`; database defaults assign fresh activity UUIDs.
Only the new attempt's response_text is completed after the call, using the same
success/failure storage described above. Earlier versions, items, and votes are
never updated/deleted, and votes are never copied.

After success the browser navigates to the new version. The version selector uses
`?version=<version UUID>`, scoped to the accessible trip, and lists all saved
versions. Without this parameter the page shows the highest-numbered version.
Earlier versions show their saved activities and feedback read-only; only the
current version accepts feedback or shows the owner's revision button. Members
can browse history but cannot revise.

As with initial generation, saving the version and its items requires separate
requests under the unchanged schema. An activity-insert failure preserves the
new prompt/response row, reports the incomplete save, and leaves earlier versions
accessible through the selector. It requires maintainer attention. A duplicate
version-number insert returns a refresh message instead of overwriting anything.

Verification:

```sh
node scripts/verify-revision.mjs
node scripts/verify-feedback.mjs
node scripts/verify-itinerary.mjs
npm run lint
npm run build -- --webpack
```

Manual revision tests:

1. Open an owned trip with Version 1 and saved activities. Submit a Like/comment
   on one activity and a Dislike/comment on another. Change one vote/comment and
   submit again so the history contains a superseded event.
2. Click **Revise with group feedback**. Confirm the disabled button/loading text,
   then confirm Version 2 appears and its activities start with zero votes.
3. Inspect Supabase: the new version has `version_number = 2`, `source =
   ai_revision`, `parent_version_id` equal to Version 1's ID, your authenticated
   owner UUID, the exact revision prompt, and the raw JSON response.
4. Check the saved prompt: it contains the original constraints, Version 1's
   activities, deduplicated Like/Dislike totals, and latest comments. The obsolete
   comment must not appear in the feedback portion. Check that new item rows
   reference Version 2 and have `origin = ai` and fresh IDs.
5. Select Version 1. Confirm its original activities, votes, and comments remain
   unchanged and feedback controls are hidden. Select Version 2 again. Refresh
   both URLs and confirm the selected version persists.
6. Rate Version 2 items, then revise again. Confirm Version 3 uses Version 2 as
   its parent and includes Version 2 feedback, while preserving original budget
   and preferences. Version 1 and Version 2 must remain selectable.
7. Sign in as an existing member: history is visible but revision controls are
   absent. A POST to `/api/trips/<tripId>/revise` must return 404 for a nonowner;
   signed-out POST must return 401, with no generation or inserts.
8. Use the local mock script to verify missing original constraints, vote-read
   failure, Gemini failure, duplicate version numbers, and partial saves without
   changing live data or RLS. Mocked failures before insertion must preserve all
   saved versions and return a clear error.

## Private trip sharing

Owners see **Share / Manage travelers** on their trip page. They can enter one
existing traveler's email, view current members, and remove a member. Sharing
adds only `(trip_id, user_id)` to `trip_members`; no public visibility field,
public share token, invitation email, schema change, or RLS change is introduced.
The traveler must have signed into TripSync already so their profile exists.

`GET`, `POST`, and `DELETE /api/trips/[tripId]/members` each authenticate the caller
and independently verify trip ownership before reading a member list, looking up
an email, or changing membership. POST normalizes the full email and calls the
existing `add_trip_member_by_email(p_trip_id, p_email)` RPC using the owner's
normal authenticated Supabase session. It does not query profiles by email or
insert membership directly. The RPC returns only a status: `success`,
`invalid_email`, `user_not_found`, `cannot_add_owner`, or `already_member`.
The UI displays the corresponding message and reloads the member list after
success or an already-member result, clearing the email input. A list-refresh
failure is shown separately from the successful membership change.

Current members are loaded from `trip_members` under unchanged RLS. The limited
display helper described below optionally supplies names and owner-only emails.
Without it, hidden names fall back to the account UUID. DELETE remains scoped to trip ID and member UUID, cannot
remove the owner, and confirms a row was removed. Feedback history is preserved.
No public directory, service-role key, SQL execution, or RLS changes are included.
The RPC was installed separately; live authenticated behavior needs manual testing.

The dashboard applies explicit owner/member filtering in addition to RLS. Trip
detail and voting already require owner/member access. Signed-out page visits
redirect to the homepage's Google login; signed-out API calls return 401. Members
can view history and submit current-item feedback, but cannot manage travelers,
generate/revise, or edit itineraries. Removing a member revokes subsequent app
reads and writes; already-rendered content in their browser cannot be erased.
Direct Supabase access continues to rely on your unchanged database policies.

Checks:

```sh
node scripts/verify-travelers.mjs
node scripts/verify-feedback.mjs
node scripts/verify-itinerary.mjs
node scripts/verify-revision.mjs
npm run lint
npm run build -- --webpack
```

Manual sharing tests:

1. Have two Google accounts sign into TripSync at least once. Open a trip owned
   by account A. Confirm it is absent from account B's dashboard and inaccessible
   through the trip URL before B is added.
2. As A, enter B's profile email and click Add traveler. Confirm the member list
   updates and `trip_members` contains the correct trip ID and B's profile UUID.
   Confirm the email input clears and the member list refreshes. Participant
   emails are available only to the owner through the optional display helper. If the RPC fails, verify its installation and EXECUTE
   permission; do not broaden profile RLS.
3. As B, refresh the dashboard and open the shared trip. Submit Like/Dislike and a
   comment. Confirm there are no management, generation, or revision controls.
   Direct management/generation/revision requests from B must also be denied.
4. As A, add B again: expect an already-added result and no duplicate membership.
   Test an invalid/unavailable email and confirm no membership row is inserted.
5. Remove B as A. Confirm the membership row disappears while historical feedback
   remains. B's next dashboard refresh excludes the trip; direct trip access and
   new votes are rejected. A retains ownership and access.
6. Test a third unrelated account and a signed-out window. Neither may read trip
   data or manage travelers. Signed-out trip pages must redirect to Google login.
7. Confirm existing RLS independently prevents unauthorized direct Supabase
   reads/writes. The local mock tests prove application checks, not live policies.

## Collaborative feedback and participant labels

The dashboard separates MY TRIPS (`trips.user_id` equals the session user) from
SHARED WITH ME (a `trip_members` entry, excluding owned trips). Shared cards say
“Shared with you” and use the owner name when available, otherwise “Owned by
another traveler”. The group feedback UI displays each user's latest vote and
comment, alongside totals and the viewer's own feedback controls. Highest bigint
vote ID wins per `(item_id, user_id)`; no user-only filter is added to vote reads.
Queries remain scoped to items loaded from an authorized trip/version.

`sql/trip-participant-display.sql` is a **manual installation proposal**, not an
executed migration. It adds only a security-definer display RPC, no tables or RLS
changes. It checks `auth.uid()` against trip ownership/membership, returns only
that trip's participants, exposes names to participants, and emails only to the
owner for traveler management. It has an empty search path and authenticated-only
execution. The existing membership list still comes from `trip_members` under
RLS; this helper enriches its labels. Missing helper access uses safe fallbacks.
When the helper is available, group summaries exclude former participants.

No live activity_votes policies were inspected or changed. The old application
query already requested group rows; the old UI discarded other travelers' comment
details. If another user's vote is absent from counts after refresh, compare the
same item query under owner/member sessions and inspect SELECT policies before
proposing a narrowly scoped policy correction. A UI fix cannot retrieve rows
hidden by RLS.

Manual checks after installing the helper:
1. Owner and member each submit feedback on one item; both should see both latest
   entries and counts after refresh. Change a vote/comment and confirm only the
   newest entry contributes while database history remains intact.
2. Confirm owned and shared dashboard sections, badges, and shared-owner names.
3. Owner sees their own identity first, then member names/emails and Remove buttons.
   Members see no management controls and receive no participant emails from RPC.
4. An unrelated account and a signed-out caller must be denied by the display RPC;
   no unrelated trip's feedback should appear. Confirm existing vote RLS separately.


## Create your own trip

`/trips` has a primary “+ Plan a new trip” action and a “Plan your first trip”
button whenever MY TRIPS is empty, including when shared trips exist. Owned cards
show Owner; shared cards retain Shared with you and the owner display name.

`/trips/new` requires Supabase Auth and collects title, destination, start date,
and end date. Both browser and API validate required values, real calendar dates,
and end >= start. `POST /api/trips` whitelists these fields and supplies `user_id`
from server `auth.getUser()`, never client input. It creates no memberships or
public visibility flag. The insert returns `id::text` to preserve bigint precision;
the browser navigates to `/trips/[id]`, where the unchanged initial Gemini form
collects preferences and creates Version 1. AI generation still supports at most
30 days and requires its existing version INSERT/UPDATE and item INSERT policies.

Read-only inspection of the live `trips_insert_own` policy confirmed it targets
`authenticated` with `WITH CHECK (user_id = auth.uid())`. No policies were changed.

Checks: `node scripts/verify-create-trip.mjs`, existing feature scripts,
`npm run lint`, and `npm run build -- --webpack` (includes TypeScript).
Manual end-to-end: sign in with a new account, use Plan your first trip, fill all
four fields, and submit. Confirm the trip opens with the AI form, appears under
MY TRIPS, and is hidden from unrelated accounts. Generate with budget/preferences
and verify Version 1. Try missing fields and reversed dates; neither should insert.

Repair regression checks: `node scripts/verify-repair.mjs` (mocked Supabase/Gemini; no live mutations). Repair diagnostics use `[Itinerary repair]` and include stage, method (`saved_response` or `saved_prompt`), and outcome without prompts or model response bodies.

## Week 5 P0 verification

The itinerary precedes a collapsed owner-only crew section. Group feedback and comments
expand on demand; Like/Dislike choices remain drafts until Submit feedback performs the
existing insert. Trip creation validates the inclusive 30-day limit in the shared parser
before any database insert. Upcoming/ongoing trips precede past trips; undated trips
remain ahead of past trips. No schema, RLS, Gemini, or vote-storage changes are required.

Additional regression checks:

```sh
node scripts/verify-auth-redirects.mjs
node scripts/verify-create-trip.mjs
node scripts/verify-public-routes.mjs http://localhost:3001
```

Authentication regression checks mock OAuth and profile responses; they do not establish
live provider configuration or session persistence. Before submission, verify on the
actual deployment with two accounts: returning login reaches Trips; an incomplete
profile reaches Profile; signed-out shared-trip login (including cancel/retry) returns
to the original trip; a member can save/reload feedback but cannot manage the crew;
an owner can generate/revise and manage travelers. Verify the callback URL with its
`next` query is accepted by the existing Supabase redirect allowlist. Check 30-day
creation succeeds and 31-day creation is blocked near the date fields. Repeat the
feedback selection/save/comment flow on desktop and mobile.

## Optional Google Places enrichment

Enable **Places API (New)** in your Google Cloud project and configure these **server-only**
environment variables locally and on the deployment:

```text
GOOGLE_PLACES_ENABLED=true
GOOGLE_PLACES_API_KEY=<your restricted server key>
```

Leave the flag unset/false or omit the key to keep the original itinerary display.
Never use a `NEXT_PUBLIC_` key. Restrict the key to Places API (New) and configure
quotas in Google Cloud; rating/count/price requests and photos can incur Google charges.
No schema, RLS, Gemini, voting, or itinerary version changes are needed.

The authenticated `/api/trips/[tripId]/places?item=<uuid>` endpoint checks existing
trip access and the item's version/trip relationship before calling Google. It reads
activity title, location, and destination from Supabase, not browser-supplied search
text. Items look up place details only when their metadata area enters the viewport.
Search uses an explicit field mask, three candidates, conservative name matching,
and bounded timeouts. Generic/unmatched activities and API failures show no extra UI.
Matches are labeled "Suggested place"; verify them on Google Maps.

The UI requests priceLevel (not priceRange), review counts and links (not review text),
and one small photo when available. Google Maps, provider, and photo-author attribution
is displayed. Photo bytes are fetched on the server without exposing API-key URLs.
Places responses use `private, no-store`; results are not persisted to the database or
local storage. Reloading can perform a new lookup. Privacy and Terms pages describe
the integration and link Google's policies; review these before enabling production.

Run `node scripts/verify-places.mjs` for mocked access/matching/failure/key-isolation
checks. A real key is still required to test live results, quota configuration, and
Google photo/link availability. Reference: [Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search),
[Maps links](https://developers.google.com/maps/documentation/places/web-service/maps-links),
[Photos](https://developers.google.com/maps/documentation/places/web-service/place-photos),
[attribution](https://developers.google.com/maps/documentation/places/web-service/policies).

## Optional landing motion

The landing preview uses original local artwork: a silent ~36 KB, four-second MP4
and ~4.4 KB WebP poster in `public/media`. No third-party footage is included.
Desktop playback is muted, looping, inline, and pausable. Mobile/narrow screens,
reduced-motion, data-saving, slow-network, and no-JavaScript states use the poster
without mounting a video. Playback errors also leave the poster available.
Set `LANDING_VIDEO_ENABLED=false` to restore the existing static destination art.
Run `node scripts/verify-landing-video.mjs` for eligibility/fallback/asset-size checks.

### Per-day map previews

Each saved itinerary day includes an “On the map” block. It lazily resolves saved stops through Places API (New) and requests a Google Maps Static API preview on the server. Enable both APIs and configure:

```env
GOOGLE_PLACES_ENABLED=true
GOOGLE_PLACES_API_KEY=your_server_places_key
GOOGLE_MAPS_STATIC_API_KEY=your_server_maps_static_key
```

Restrict the second key to Maps Static API. Neither key is sent to the browser. Restart locally or redeploy after configuring environment variables. Both APIs require appropriate billing/quota configuration. Resolution and map failures preserve the itinerary and Google Maps search links for every stop. All resolved markers use forest green; the map automatically frames their coordinates. The map is a static preview, not an interactive route planner.

Requests use the existing owner/member access check and validate the selected version belongs to the trip. Place IDs, coordinates, and categories live only in the current response/page state; no schema changes or persistent Places-content cache are introduced. Maps retain Google's full attribution (no cropping). See [Maps Static API setup](https://developers.google.com/maps/documentation/maps-static/start) and [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies).

### Deployment troubleshooting and trip actions

The trip owner now has Share trip, Copy trip link, and Delete trip actions directly below the destination hero. Share opens the existing traveler access form; copying the URL does not grant access. Delete requires explicit confirmation and performs one owner-filtered database delete under existing RLS. Database foreign-key or policy failures are reported without deleting child rows separately. Verify deletion with a disposable owner-created trip on the deployed schema; this change does not add or bypass delete policies/cascades.

Places now activates when its server key is present unless `GOOGLE_PLACES_ENABLED=false` explicitly disables it. Static maps can reuse `GOOGLE_PLACES_API_KEY` if `GOOGLE_MAPS_STATIC_API_KEY` is absent; the shared key must permit both Places API (New) and Maps Static API. Upstream HTTP failures log only status codes, never keys. No-match, missing configuration, and unavailable previews have visible fallback messages.

If production still shows “Skip” or the old “saved places” landing copy, check Vercel's Production branch and deployment commit against the pushed commit. Redeploying an older deployment does not incorporate newer source changes. Confirm the newest deployment is assigned to the production domain and includes the Production environment variables. Google ratings/reviews links only appear for successful place matches; no reviews are fabricated.

### Owner deletion database repair (applied 2026-10-12)

Live inspection confirmed `trips` had no DELETE policy, and all five trip/version/item foreign keys used RESTRICT. Applied `sql/trips-delete-owner.sql` to the existing Supabase project: owner-only DELETE policy, cascading trip-owned children, and a deferred NO ACTION parent-version reference (never cascade into another trip). Child-table RLS, authentication, and voting insertion rules are unchanged.

Verified against the live database inside a rolled-back transaction with a new temporary trip, member, two linked versions, activity and vote. With the authenticated role and member identity deletion affected zero rows; with the owner identity it affected one row, and all fixture descendants were removed. Immediate constraint validation passed. No existing trip was deleted. Local and deployed clients using this database receive the fix immediately; deployment is not required for this SQL repair.

### Destination hero photo carousel

Set `GOOGLE_MAPS_API_KEY` in `.env.local` and Vercel (Production and Preview as needed), enable **Places API (New)** with billing, and restrict this server key to that API. Never use a `NEXT_PUBLIC_` variable. Restart local development or redeploy after adding the variable. Existing Gemini/Supabase/map variables are unchanged.

The trip hero uses `DestinationHero` and `DestinationPhotoCarousel`. The authenticated `/api/trips/[tripId]/destination-photo?index=0` endpoint checks existing trip access and obtains the saved destination server-side. `lib/google-places.ts` normalizes it, uses Text Search (New) (`POST /v1/places:searchText`), then Place Details (`GET /v1/places/{id}`) for repeated destinations, and Place Photos (`GET /v1/places/{id}/photos/{photo}/media`). Field masks contain only id, displayName and photos. Media is fetched server-side without forwarding the key to the media host; no upstream error bodies are exposed.

Up to five slides load on demand, with native keyboard-accessible previous/next buttons and dots, visible author credits, reduced-motion support and original hero dimensions. Missing key, unknown/mismatched destination, quota, missing photos, and media errors retain the existing illustration. This only changes the trip-detail hero.

Caching: a bounded process-local map retains only place IDs by normalized destination for up to 30 days (256 entries; resets on restart/serverless cold start). Photo references and responses use no-store; no Next revalidation of photos, database migration or persistent media cache. Loaded slides stay in the mounted carousel so rerenders/navigation between loaded slides do not call Google again. Google prohibits caching photo names: https://developers.google.com/maps/documentation/places/web-service/place-photos

`node scripts/verify-destination-photos.mjs` mocks Puerto Rico, Lisbon, Tokyo, Miami and an unknown destination, along with quota, missing key/photos, key isolation, unsafe media rejection and ID reuse. Actual destination photos and browser visuals require live verification with the configured key.

Destination hero key compatibility: `GOOGLE_MAPS_API_KEY` is preferred, but the carousel also accepts the existing server-only `GOOGLE_PLACES_API_KEY` when the former is absent. No duplicate local key is required. Dashboard cards still use illustrations; the photo carousel is scoped to trip-detail heroes.

### Collection, consensus and planning-history UI

Dashboard cards use destination-specific Places photography with illustrations on failure. Desktop QA measured about 65% photo area per card. Traveler totals come from the existing authorized participant-display RPC; unavailable totals use an identity label, not an invented number. Status is date-based (Upcoming, In progress, Past trip, Dates to confirm), never approval-based.

The latest itinerary's Group Consensus uses existing latest-per-user/activity vote summaries, filtered again against current authorized participants. “Activities reviewed” means at least one participant responded; full completion is responses divided by (authorized participants including owner × activities). Like/Dislike activity totals can overlap; mixed activities are labeled. No approval workflow is implied. Participant/feedback failures show unavailable progress. No schema changes are needed; the existing `trip_participant_display` RPC must be available for authoritative participant totals.

Planning history lists real version creation times in UTC, AI/manual source labels, links to earlier versions, and each version's currently stored participant feedback counts. It retains the version selector. It does not claim that those votes are a historical snapshot of the feedback used to generate a revision; the current data does not establish that snapshot.

Day maps use Google Static Maps at explicit center/zoom with matching Mercator-positioned, keyboard-accessible HTML marker buttons. Category icons/colors use Places primaryType (food, stay, attraction/other). Marker numbers and lists retain itinerary order; selecting a marker shows its name/category and Google Maps link. Unknown coordinates are omitted. No routes are invented, and no new browser API key or Maps JavaScript API is needed. Base-map panning/zooming is not implemented. Co-located stops may overlap; all places remain accessible in the ordered list.

Trip-detail photo carousel supports horizontal mobile swipes without blocking vertical page scrolling. The new Forest/Sage/Mist/Ivory/Coral palette preserves the two-font system and existing destination hero themes.

Verification: production build, TypeScript, lint and all verification scripts passed (public-route checks run against production build, because Next development redirects use different cache headers). Added consensus tests for duplicate/replaced votes, removed members, denominator/empty states, and map projection/category tests. Live owner browser checks: destination card photos, traveler counts, history data, second carousel photo, restaurant marker details and 390px overflow. Physical-device swipe, member account end-to-end interaction, and live hotel marker examples remain manual checks. No live votes, sharing changes, generation or database mutations were performed for this UI iteration.

## TripSync collaboration — Phase 1 + Phase 2

This upgrade preserves the existing visual design, hero/carousel, timeline, maps,
Places, invitations, and append-only Like/Dislike/comment behavior. It adds compact
Travel preferences and Suggestions to review cards using the existing styles.

**Database installation:** Run **`sql/trip-collaboration.sql` once**, as postgres in
Supabase SQL Editor, after verifying that you have selected the same project as
`NEXT_PUBLIC_SUPABASE_URL`. This is the single complete migration for both phases;
it does not require installing an additional display helper. It assumes the
existing `trips.id` is bigint, `profiles.id`, `itinerary_versions.id`, and
`itinerary_items.id` are UUIDs, and the existing private-trip schema matches the
app. The transaction rolls back on a schema mismatch. It adds two tables, scoped
helper functions, grants, RLS, triggers, composite foreign keys, and indexes. It
does not change existing table RLS policies or rewrite votes or versions. Apply
before deploying these application changes. A missing migration shows an explicit
unavailable message and prevents AI generation from silently ignoring preferences.

- Every current participant, including the owner, can save and update their own
  preferences. Budget is optional, with an explicit three-letter currency and
  per-person daily or trip-total scope. Lists allow 30 entries of 300 characters;
  notes allow 2,000 characters. Current participants can view group preferences.
  Removed members lose access and their preferences are excluded from the group.
- Initial generation loads current participants and all available saved preferences
  server-side. Missing submissions never block generation: the owner sees progress
  and a **Generate anyway** action. Owner trip-level budget/interests are now
  optional additional guidance (superseding the earlier required-fields description).
  No preferences still produces the existing itinerary schema. Member text remains
  untrusted data; hard-constraint conflicts must be explained in activity descriptions,
  and incompatible budget currencies/scopes must never be silently combined.
  Existing prompt/response persistence, validation, owner-only access, repair and
  version semantics remain intact.
- **Suggest a change** expands independently of Like/Dislike, with seven categories,
  optional explanation and replacement (required for Suggest replacement). It never
  inserts a vote. Suggestions are immutable after submission; editing is intentionally
  unsupported. The database checks current membership, author identity, the latest
  version, and matching trip/version/item references.
- Owners see all suggestions for the selected version, grouped by day, with accurate
  pending/resolved/declined totals and owner-only resolution/decline actions. Members
  see their own submissions and statuses. Reviewed entries remain available in a
  compact disclosure. Selecting an earlier version shows its historical requests;
  a new version never copies, deletes, or silently resolves earlier requests.
  Owners may explicitly review pending historical suggestions. Existing full
  itinerary revision is unchanged; partial AI revision is not implemented.

Endpoints (session-authenticated, private/no-store):
`GET/PUT /api/trips/:tripId/preferences`,
`GET /api/trips/:tripId/suggestions?version=:uuid`,
`POST/PATCH /api/trips/:tripId/suggestions`.
Identity fields are supplied by the server, and database grants/RLS independently
restrict writes even when the API is bypassed.

Validation:

```sh
npm run test:collaboration
for script in scripts/verify-*.mjs; do node "$script" || exit 1; done
npx tsc --noEmit
npm run lint
npm run build
# If the environment blocks Turbopack's local CSS worker port:
npm run build -- --webpack
```

`verify-collaboration.mjs` tests API behavior and paginated loading with a stateful
mock. `verify-collaboration-db.mjs` executes the complete migration in isolated
WASM PostgreSQL (PGlite) with representative private-trip tables, then tests real
RLS/grants, persistence/upsert, unauthorized and removed-member denial, association
constraints, owner resolution/decline, and historical vote/version preservation.
`verify-itinerary.mjs` covers submitted, missing, empty, and unavailable preferences
and existing generation failure/persistence behavior. These tests do **not** prove
that the connected Supabase project's schema, policies, or deployment work.

**Live verification still required:** No migration has been applied to Supabase by
this implementation. After installing the SQL, use a disposable trip with owner,
member and unrelated accounts: save/update preferences and reload; generate with
some and no submissions; submit a suggestion without casting another vote; resolve
and decline as owner; select an earlier version after revision; remove a member and
confirm their direct API/database access is denied. Verify logged-out access is
also denied. Check the rendered cards on desktop/mobile and confirm the carousel,
Maps/Places, OAuth and invitations still work in the deployed environment.

Files changed for this upgrade:

| Area | Files |
| --- | --- |
| Migration | `sql/trip-collaboration.sql` |
| API | `app/api/trips/[tripId]/preferences/route.ts`, `app/api/trips/[tripId]/suggestions/route.ts`, `app/api/trips/[tripId]/generate/route.ts` |
| UI | `app/trips/[tripId]/page.tsx`, `components/travel-preferences.tsx`, `components/activity-suggestion.tsx`, `components/suggestions-center.tsx`, `components/activity-feedback.tsx`, `components/generate-itinerary-form.tsx`, `app/globals.css` (new select controls only) |
| Logic | `lib/collaboration.ts`, `lib/collaboration-server.ts`, `lib/collaboration-route.ts`, `lib/itinerary.ts`, `lib/gemini.ts` |
| Verification | `scripts/verify-collaboration.mjs`, `scripts/verify-collaboration-db.mjs`, `scripts/verify-itinerary.mjs`, `scripts/verify-presentation.mjs` |
| Setup/docs | `package.json`, `package-lock.json`, `README.md` |

Start a local app server in another terminal before running
`verify-public-routes.mjs` (default `http://localhost:3000`, or pass another origin).
All other verification scripts run without a server. Supabase and Gemini calls in
those scripts are mocked; the database suite uses only in-memory PostgreSQL.

The preference editor and initial generation action now share the existing pale-blue
planning card. Personal interests and constraints are entered only in preferences;
optional group budget/logistics are collapsed under Extra trip instructions. Only
the owner sees generation controls, and these are hidden while editing preferences
to avoid generating from unsaved edits. No additional database migration is needed
for this layout change.

Activity feedback now keeps Like/Dislike and routes new written feedback through
Suggest a change. The standalone vote-comment editor has been removed; existing
comments remain visible and are retained when a traveler changes their vote. The
replacement text field appears only for Suggest replacement. This UI simplification
requires no additional Supabase migration.

## Phase 3 — collaborative drafts and AI proposals

The received Phase 3 specification ends mid-sentence in section 12 ("Compare the
current normalized"). The implementation covers all complete requirements received,
including snapshot comparison and an owner-reviewed full regeneration flow. No
additional requirements beyond that truncated text have been assumed.

**Installation:** After the Phase 1/2 migration is installed, run
**`sql/trip-phase3.sql` once** as postgres in the intended Supabase project's SQL
Editor, before deploying this code. Do not rerun `trip-collaboration.sql`. The new
transaction adds `itinerary_versions.preference_snapshot`, `itinerary_proposals`,
its private-trip RLS policy and checked RPCs. It does not backfill, rewrite, or
remove historical itineraries, feedback, or votes. Existing versions/items keep
existing RLS; no new direct version/item write privileges are granted to members.
All new publication goes through transaction-scoped, participant/owner-checked
functions with fixed search paths and restricted execution grants.

Actual remote schema/admin access is unavailable in this environment. A read-only
attempt to fetch the configured project's public API schema was denied. Migration
verification therefore uses a representative PostgreSQL schema reconstructed from
the application's routes, queries and existing migrations; this is not verification
of the live project's column types, triggers or policies. In particular the migration
expects existing UUID version/item IDs, bigint trip IDs, date trip dates, and the
existing `parent_version_id`, `source`, `origin`, prompt/response and ordering columns.
It supports existing source/origin column types through `%type`. Schema errors roll
back the migration; report the error rather than deleting existing tables.

Manual editing:

- Current owners and members can **Edit itinerary**, add/remove/change activities,
  change day/time/title/location/description, and move activities up/down within a day.
  The existing timeline/card classes are reused. Maps, photos and ordinary feedback
  return with the unchanged viewing timeline when editing is closed.
- Drafts are held locally until **Save changes** opens the Added/Removed/Updated/Moved
  summary. **Save new version** publishes; **Continue editing** and **Discard changes**
  remain available. Browser reload/navigation discards an unsaved local draft.
- A draft records its starting version. `save_manual_itinerary` locks the trip,
  checks current participation and the latest version, validates fields, source IDs,
  dates and contiguous ordering, and creates version+items in one transaction.
  Removed members are denied. Stale saves return HTTP 409 with the specified message
  and a link to review the latest itinerary; no automatic merge occurs.
- New/changed content uses manual origin; unchanged copied content retains its origin.
  All new rows get fresh item IDs. Previous items, votes, and requests remain untouched.
  Empty days are allowed for manual plans; entirely empty plans are rejected.

AI assistance:

- **Ask AI to revise a day or activity** allows participants to select exactly one
  activity or day and provide instructions. Current preferences, hard constraints,
  current-member latest votes and relevant pending structured suggestions enter the
  prompt as untrusted data. No Places data is persisted or invented as verified data.
- Gemini returns a schema-validated replacement, explanation and uncertainties. A
  proposal is stored separately from itinerary versions and visible to all current
  participants, so an owner can review a member's proposal later.
- The **AI proposals** disclosure shows Before/After, the explanation, uncertainties,
  and an explicit list of unchanged activities. Only the owner sees **Apply changes**.
  Applying rechecks ownership, latest base version, current preferences and trip
  details; the database assembles the replacement from the immutable saved response.
  It never trusts a client-supplied merged itinerary. The exact prompt/response and
  preference snapshot are saved on the new `ai_revision` version.
- One-activity proposals replace exactly one activity on the same day. One-day
  proposals replace that day's activities only. Other days/activities are copied
  exactly (including ordering and origin). Invalid AI scope or failed generation
  creates no published version. Failed publication rolls back the entire transaction.
- Earlier versions retain their proposal records and votes. Publishing never resolves
  a feedback request automatically; the existing explicit owner actions still apply.
- The former immediate full-revision button is replaced in the detail UI by this
  preview workflow. The legacy `/revise` endpoint now delegates to the same proposal POST/PATCH
  handlers and cannot publish immediately. Empty-version repair remains available;
  its item writes share the trip publication lock.

Preference-based regeneration:

- Initial AI generation and applied proposals save normalized JSONB preference
  snapshots, including the current participant IDs and submitted preference content.
  Comparison ignores preference-row timestamps. No-op saves do not trigger warnings;
  member joins/removals or content changes do. Manual versions do not reset the last
  AI baseline, and unapplied proposals do not reset it either.
- Owners see **Travel preferences have changed** and **Regenerate with updated
  preferences**. This opens a full-trip AI proposal, followed by the same owner-only
  Before/After application workflow. Saving preferences never calls Gemini or changes
  the published itinerary. Members cannot request full regeneration or apply AI.
- Old versions without a snapshot are reported as having an unknown baseline, rather
  than falsely claiming that preferences changed. Owners may regenerate to establish
  a baseline. Proposals become stale if preferences change before application.

New endpoints:

- `POST /api/trips/:tripId/edit`: `{base_version_id, activities}`.
- `POST /api/trips/:tripId/proposals`: `{base_version_id, scope, day, item_id, instruction}`;
  scope is `activity`, `day`, or owner-only `trip`.
- `PATCH /api/trips/:tripId/proposals`: `{proposal_id}`; owner-only application.

New source files: `components/itinerary-workspace.tsx`,
`lib/itinerary-editing.ts`, `lib/itinerary-editing-server.ts`,
`lib/proposal-prompt.ts`, the two routes above, `sql/trip-phase3.sql`,
`scripts/verify-phase3.mjs`, and `scripts/verify-phase3-db.mjs`.
Integration changes: trip detail page, initial generation route and its tests,
`lib/gemini.ts`, one select-style selector in `app/globals.css`, and `package.json`.

Run `npm run test:phase3`, the existing verification scripts, `npx tsc --noEmit`,
`npm run lint`, and `npm run build -- --webpack`. Phase 3 tests exercise validators,
diffs, scope enforcement, context construction, member/owner API behavior, rendered
previews and real PostgreSQL RLS/RPC execution. The database suite covers rollback
on simulated item insertion failure, stale drafts/proposals, exact prompt/response,
unchanged content/history, removed-member denial and preference change detection.

After installing the migration, verify live with two participants: start concurrent
manual drafts and save one, then confirm the other is rejected without losing its
local draft; request a member AI proposal and apply it as owner; check untouched days
and history; update preferences, regenerate through preview, and verify the warning
clears after applying. Verify a removed member cannot call the new RPCs, and check
editing/preview controls on desktop and mobile. None of these live checks has been
claimed as complete, and no Supabase migration was applied automatically.


### Unified publication concurrency update

For an existing Phase 3 installation, run **`sql/trip-publication-concurrency.sql`**
in the same Supabase project. This incremental patch is repeatable and does not
rewrite data. New installations should run the updated `sql/trip-phase3.sql`, which
already includes these changes; do not rerun the original table-creation migration
on an installed project.

Manual drafts, owner-applied activity/day proposals, and owner-applied full
regenerations all use `publish_trip_draft`. The function locks the trip, rechecks
membership/ownership and the latest **published** base, then writes version+items
atomically. A published version has persisted items; empty failed attempts stay in
history and reserve their version numbers without displacing the visible published
plan. The trip page, editing context, vote/suggestion checks and AI preference
baseline use this same definition. Item insertion (including legacy recovery),
preference writes and membership changes take the same trip lock. This serializes
publication against its inputs, rather than only comparing a snapshot before an
unprotected write. Ordinary viewing does not acquire a write lock.

Every stale publication returns HTTP 409 with the exact message:

> This itinerary has been updated by another traveler. Please review the latest version before applying your changes.

Drafts remain in local state after rejection; reviewing the latest itinerary opens
a new tab so it does not discard the draft. Stored AI proposals remain unapplied and
accessible in the original version's history. The UI never silently merges or
rebases them. A changed preference/trip snapshot returns a distinct HTTP 409 warning
requiring a refreshed proposal. No client timestamps are used for these decisions.

The legacy `/revise` endpoint is now an alias of the proposal workflow: POST requires
an explicit `base_version_id` and creates a preview, PATCH applies an existing
proposal with the same owner and database checks. Its former empty-body immediate
publication contract has intentionally been retired. The compatibility button links
to the preview controls instead of calling an immediate publisher.

The expanded Phase 3 database suite verifies stale partial/full proposals after a
member publishes a manual draft, exact conflict text, retained rejected proposals,
preference invalidation for full regeneration, authorization, failed-attempt version
number reservation, and repeatable incremental migration installation. These are
isolated PostgreSQL checks; the live Supabase patch still needs manual installation
and a two-browser concurrency check.

## Week 6 — Community + separate Admin

Trip owners can publish a separate, public snapshot of their latest saved itinerary and withdraw it without changing the private workspace. Community visitors browse/search destinations and view activity details with the existing Google destination photo flow. Signed-in users can upvote/downvote a publication, change their vote or remove it. Community votes are separate from existing group activity feedback.

The independent `trypsync-admin` app manages snapshot CRUD, reads users/profiles and both kinds of ratings, and presents database statistics. It uses the same Supabase project and enforces Google login plus the database superadmin flag on every privileged operation.

Apply **one copy** of `sql/week6-community-admin.sql` before using these features. Follow [Week 6 setup](sql/week6-setup.md) for administrator bootstrapping, OAuth callbacks, deployment and acceptance checks. Until then Community displays an unavailable state; existing private trip features still work.

```sh
npm run test:week6
```

No live migration or role elevation is performed by the application or these tests.
