# TripSync ecosystem integration — implementation record

Status: implementation in progress. The approved additive migration was applied successfully to TripSync project `gzlzlofrngnqlbcngndf` on November 3, 2026. Existing RLS policies were inspected and preserved. The server credential hash is configured; its value is never included in this document. Deployment and live-model evidence follow below as executed.

## Existing architecture

- Public: Next.js App Router; private trips, preferences, itinerary versions/items, collaborative revisions, activity votes, Community publications. Initial/repair generation in `lib/gemini.ts`; proposal generation is validated and explicitly applied via database RPCs.
- Admin: separate Next.js repository, Google login and `is_superadmin()` checked in pages/actions/RPCs. `admin_resources` stores legacy model configuration and generation logs. Community and activity votes have separate meanings.
- Studio: separate Next.js repository, the same checked superadmin role; `studio_chains` stores editable steps, `studio_runs` stores exact snapshots and actual outputs. Existing Studio drafts do not yet control Public generation.
- All three local configurations were verified to reference `gzlzlofrngnqlbcngndf.supabase.co`. No Chucklesome project was accessed or changed.

## Implementation plan

1. Add immutable tested publications, a single active trip-planning publication, server-gated generation records, and explicit version-level feedback. Preserve all existing tables and policies.
2. Package one canonical sequential executor as a versioned local archive committed to both repositories. Public and Studio install the exact same artifact; no cross-repository imports or third AI executor.
3. Execute only the designated active publication for new initial itineraries and AI proposals. Keep legacy generation explicitly labeled when integration is not enabled. An enabled integration fails clearly if configuration is unavailable.
4. Store immutable publication IDs and real per-step outputs. Atomically finalize initial itinerary items/response. Associate proposal runs with their applied itinerary version without rewriting historical provenance.
5. Add save/test/publish, version inspection, sequential drag ordering, concise cross-app navigation, Public feedback and an Admin generation/feedback view.
6. Run isolated security/schema/contract checks, existing regressions, type/lint/build checks and browser checks. Apply only the verified additive migration with approval. Deploy each repo and test real provider responses and persisted A–E scenarios using authorized dedicated test sessions.

## External prerequisites

- Approval for additive remote schema changes, including overall itinerary feedback.
- Approved server-only integration credential configuration, without exposing the value.
- Dedicated authorized superadmin and traveler test sessions. Live tests remain BLOCKED until these are available.

## Checks executed

- Production builds: Public, Admin and Studio passed.
- Public lint and TypeScript passed. Collaboration/itinerary, Phase 3, Week 6, Week 7, generation metrics, and repair checks passed after updating outdated VM import adapters to account for the published-workflow module. Adapters remain clearly mocked; database suites execute actual PostgreSQL functions in PGlite.
- Studio lint, chain/step database security suite, legacy variable-resolution equivalence and actual route/shared-executor tests passed.
- Admin lint, authorization and response presentation suites passed.
- New isolated PostgreSQL integration suite passed: immutable publications, draft isolation, dual server/JWT authorization, trip isolation, ordering, transaction rollback on item failure, revision-to-applied-version attribution, feedback ownership/upsert and Admin visibility.
- Local production Studio browser: keyboard drag moved Step 2 to Step 1, Save persisted it after reload, and the intended order was restored and saved. This is not yet a deployed-browser test.

## Security and runtime contract

`studio_gateway(secret, action, data)` is callable only with both the Public server's random credential and an authenticated traveler's JWT. It independently checks trip access and the targeted itinerary. Private draft/published prompt tables and run tables have no traveler read/write grants. Published prompts are returned only through the credential-gated server path. Studio publication and Admin reads independently require `is_superadmin() === true`.

Public and Studio install byte-identical `@tripsync/chain-runtime` 1.0.1 archives (SHA-256 `3c1341db012eba92f5762e40b4f7ae9114ed75f4647078f125188cfc1f824302`). Canonical source: `packages/chain-runtime`. The pure prompt submodule is safe for variable previews; only server code calls the provider executor. Only existing Google Gemini is used. No service-role credential is required.

With `TRIPSYNC_STUDIO_ENABLED=true`, initial generation, repair and revision proposals use the active immutable publication. No enabled-integration failure falls back to a different prompt. With the flag disabled, the existing legacy path is explicit and has no Studio attribution. Previously generated versions retain their existing history.

The final deployment URLs and real A–E test evidence will be added only after actual execution.
