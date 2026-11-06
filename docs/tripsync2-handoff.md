# TripSync 2 implementation and verification

## Implementation

Public App extends the existing journal UI with Itinerary, Flights & Stays, Expenses and Members sections. A persistent shared trip Copilot uses server-side structured Gemini intent classification, explicit member authorization, 50-message history loading, bounded model context, current selected version, actual activity feedback, overall ratings and reservation context. Retrying the same request ID does not duplicate stored messages. Assistant responses are persisted only by the secret-authenticated server workflow.

Chat revision requests generate a preview through the existing published regional chain; application uses the existing owner-confirmed version publication RPC. Exact parent, instruction, author, proposal, run and publication links remain intact. `trip_context.source_action` distinguishes a verified chat message revision from other requests. Full before/after review remains in the existing itinerary workspace. Stale itinerary/preference/reservation previews are rejected. Earlier versions and their ratings are retained.

Flights & Stays supports manual flight/hotel creation, editing, removal, local datetimes/IANA zones, explicit planned/saved/booked/canceled states and no payment or confirmation-code collection. All generation/revision prompts include valid saved travel details, with booked entries treated as user-confirmed constraints and planned entries as preferences. Saving does not generate a version.

Discovery is an on-demand provider abstraction with a truthful Google Travel external-link adapter. No supplier credentials are configured, no inventory API is called, and no prices or availability are fabricated. Search fields must be confirmed at the external provider. No purchase workflow exists.

Expenses support subsets of existing trip members, equal/custom/percentage allocation, integer minor units, currency-specific decimal scales, largest-remainder rounding (stable UUID tie break), separate currency ledgers and deterministic matching. Owner-confirmed SQL settlement independently recalculates balances/transfers, checks the reviewed expense fingerprint, locks an immutable snapshot and starts new cycles for later expenses. Only transfer recipients can confirm receipt. No real money is moved. Creator/owner edits are restricted to open expenses; settled expenses cannot be edited/deleted. Historical payer/participant IDs are retained even after membership removal.

Studio and Admin require no application changes: existing regional publications, React Flow and Admin generation provenance views are reused. Admins receive no new access to conversations or expense records. Chat source is visible in stored generation prompts/context, while existing generation counts/status/routing/publication/latency/feedback remain available. No new provider metrics are represented because no provider API is configured.

## Migrations and deployment order

Apply in order: `sql/tripsync2-copilot.sql`, `sql/tripsync2-reservations.sql`, `sql/tripsync2-reservation-concurrency.sql`, `sql/tripsync2-expenses.sql`. These require the existing collaboration, publication-concurrency, Studio integration and regional-routing installation. New-table migrations are one-time additive scripts, not repeatable resets. Run as one reviewed transaction. Database data is not reset. The concurrency extension preserves the existing function contracts and accepts older proposals without reservation snapshots.

Uses existing server-only `GEMINI_API_KEY`, `GEMINI_MODEL` (optional) and `TRIPSYNC_CHAIN_SECRET`; existing Supabase public configuration/auth cookies and Studio settings remain in place. Never expose server secrets to client bundles. No new supplier keys are required for the external fallback.

## Local checks

Passed: TypeScript, ESLint, Webpack production build; new deterministic amount/split/settlement/intent/reservation/search tests; new real PostgreSQL/RLS migration tests; existing Phase 3 version/proposal tests; Studio integration, regional routing and prompt-context regressions. PostgreSQL tests run on isolated PGlite and are not evidence of a live Gemini run. Default Turbopack build cannot bind its build-worker port in this execution environment; `npx next build --webpack` succeeds.

## Live evidence

Supabase SQL editor inspected the actual project, existing RLS, installed publication/revision functions and record counts. Before migration: 18 trips, 33 versions, 473 itinerary items, 9 immutable chain publications. Publication fingerprint: `7c94b116efc8d23014526b4388b59794`. The four migrations were applied successfully in one transaction on November 6, 2026. Post-migration counts and E2E/deployment evidence are appended below as verified.

## Limits

- External search links, not live inventory. Approved commercial provider access remains an independent integration step. Official references: https://duffel.com/guides/getting-started and https://duffel.com/docs/api/overview/test-mode explain live activation and the limits of test inventory. Amadeus reference: https://amadeus4dev.github.io/developer-guides/test-data/.
- Copilot shares history with current trip members; UI loads the latest 50 messages, model context uses the latest 12 with a 90,000-character bound. No automatic long-history summarization or message deletion/retention administration yet.
- Natural-language reservation/expense intents currently open review forms; users enter/select structured details. Automatic extraction and identity matching are not implemented.
- Supported currencies are an explicit subset; unsupported currencies are rejected. No exchange conversion. Open ledger UI is capped at 999 expenses and fails explicitly above that rather than computing an incomplete settlement.
- Search is a link adapter, so supplier error/rate-limit metrics and live result comparison/saving are not applicable; users can manually save planning options.
- Nonmember and three-account deployed tests must be explicitly recorded as blocked if dedicated authorized accounts are unavailable.
