# Week 7 — observability and administration

No previous-week instructor feedback was provided. This update implements the listed technical requirements; it does not claim feedback points were awarded.

## Installation

Both repositories use the existing TripSync Supabase project. Run **one copy** of `week7-observability.sql` once, after Week 6, as postgres. This transactional migration creates `admin_resources`, checked RPCs, seeded Gemini/provider/model/chain/step/mix records, and the private `admin-images` bucket. Do not rerun it after successful installation. It does not modify existing private trips, users, itineraries or Community posts. Deploy both repositories after migration.

Resources use namespaced JSONB records in `admin_resources` rather than inventing columns on existing application tables. Authenticated users have no direct table access. Every administration RPC checks the existing Google-only `is_superadmin()` function; Server Actions independently recheck authorization. Generation start/finish RPCs are authenticated, and completion is restricted to the requesting user and a pending request.

## Requirement mapping

- Users: existing `/users` (profiles + auth user information), read-only.
- Prompt chains and ordered steps: `/manage/prompt-chains`, `/manage/prompt-chain-steps`, read-only. The existing itinerary/proposal workflows each execute one schema-constrained model call; their one-step chains are seeded from these real workflows.
- Prompt chain mix: `/manage/prompt-chain-mix`, read/update only. Weight is relative within a generation kind. Enabled chains are selected with weighted random routing. Disabling all chains for a kind causes an explicit generation configuration error. Additional chains/steps are provisioned through reviewed migrations because the assignment only requires read access to these resources.
- Terms: `/manage/terms`, full CRUD.
- AI media: existing `/media` manages public snapshots; `/manage/generated-media` shows newly observed model output, including readable activity previews and request links.
- Generation requests: `/manage/generation-requests`, read-only, searchable prompt, status, user, chain, step, model reference and completion metadata.
- Examples: `/manage/ai-generation-examples`, full CRUD of input/output/notes.
- Models/providers: `/manage/llm-models`, `/manage/llm-providers`, full CRUD. Referenced providers/models cannot be deleted. Actual execution continues to use the Gemini adapter and server-side `GEMINI_API_KEY`; provider records contain no credentials. `deployment-default` resolves to server `GEMINI_MODEL` or the existing fallback. Adding a different provider record does not install a provider adapter.
- Responses: `/manage/llm-responses`, read-only, linked to requests. Failed calls retain captured partial text where available. Logs over 80,000 characters are explicitly truncated; existing itinerary persistence remains unchanged.
- Signup domains/emails: `/manage/allowed-signup-domains`, `/manage/whitelisted-emails`, full CRUD with normalization, validation and uniqueness. These manage the requested lists; they do not retroactively restrict existing Google OAuth access.
- Images: `/manage/images`, create through upload, read/signed preview, update title, delete metadata + file. JPG/PNG/WebP up to 4 MB. Private bucket, fresh object names, no overwrite, 5-minute signed previews. Changing an existing image's storage path is rejected; upload a replacement as a new image.

## Observability rollout

Both repositories' Gemini helpers start a durable request before the model call and finish it with a response plus success/failure status. Mix and model configuration are read from the database. Missing Week 7 RPCs temporarily retain the previous generation behavior and log a server warning; other configuration and authorization errors fail explicitly. Existing historical itinerary records are preserved and are not fabricated into historical request logs. New observed output is logged separately from publication: a successful model response is not a claim that a proposal was applied.

## Verification

Run `npm run test:week7` in either repository for isolated PostgreSQL-compatible CRUD, RLS/permissions, validation, search/pagination, storage policies, weighted routing, request ownership, failure/success logging and replay tests. Main app: also run `npm run test:week6`, `npm run test:phase3`, lint and build. Admin: run `npm run test:security`, lint and build.

Live checks:

1. Signed-out admin routes redirect to login; a non-admin Google user is denied.
2. Administrator opens every sidebar section. Chains/steps/provider/model/mix seeds load.
3. Create/update/delete a term, example, unused provider/model, signup domain and email. Verify after refresh; test invalid/duplicate entries and cancel deletion once.
4. Update a mix weight, refresh, and verify it persisted. Keep at least one enabled chain per generation kind.
5. Generate an admin media preview or main-app itinerary. Verify the real request, response and generated output; opening request/response links should find the associated record. Test a provider failure without publishing an itinerary.
6. Upload an image, preview it, change its title, refresh, and delete it. Confirm its bucket object was removed. Test invalid file type and size.
7. In each existing Vercel project, check Deployment Protection is off. Retain application login and database checks. Verify from an unauthenticated/private browser session. Submit the latest commit-specific deployment URL for both apps, not just their production aliases.
