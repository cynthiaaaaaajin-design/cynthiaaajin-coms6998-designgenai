# TripSync 3 — Group Decisions

## Delivered functionality

- Extended the existing shared, own-editable preference editor with explicit activity priorities, dietary restrictions, preferred transportation and availability dates. Existing must-have places/activities, nice-to-have interests, hard constraints, budget scopes and travel pace remain in the same schema/API. Sharing is explained before submission.
- Deterministic discussion topics distinguish explicit incompatible activity requirements and scheduling issues from ordinary budget/pace differences. Compatible interests are not treated as conflict; unrelated currencies/scopes are not compared or averaged. Optional AI interpretation requires exact saved quotes from distinct members and is labeled as a suggestion for human review.
- Decision rounds freeze the current itinerary, member electorate, preference evidence, trip/reservation context, decision rule and optional deadline. A member may open a planning question without claiming anyone disagrees. One-person rounds are explicitly solo.
- Two or three alternative instructions reuse the same scoped itinerary proposal service and existing published regional chains. Schema-valid generated previews show actual before/after, the model's supported preferences/tradeoffs explanation and uncertainties. Each alternative needs an explicit initiator/owner review before voting opens. No generation publishes a version.
- Voting is identifiable to current trip members, unique per member/round, changeable until final application/deadline, and enforced server-side. Default unanimity requires all members to support one option; optional strict majority requires floor(N/2)+1 of the full frozen electorate. Missing votes are not approval; ties are not agreement.
- Owner confirmation applies only the qualifying winning option, preserving the exact parent, votes, preference context, proposal, run and immutable publication. Database triggers prevent bypass through the existing proposal apply endpoint. Context/membership/reservation/version changes make an open round stale.
- A dedicated Group Decisions tab provides preference cards, topic summaries, alternative comparison, voting status, voters, deadlines and history. Existing activity review progress is labeled Activity Feedback so it is not confused with a voting decision.
- Copilot reads actual current discussion and voting metadata, plus an explicitly requested historical decision and its saved proposal context. Requests for another group compromise open Group Decisions; hypothetical budget questions do not modify preferences, votes or itineraries. Votes do not supply personal motives.

## Architecture and files

Domain: `lib/group-decisions.ts`. Existing preference types/parser, server loaders and snapshot comparison were extended. The former proposal POST implementation was extracted to `lib/itinerary-proposal-service.ts`, reused by ordinary revisions and group candidates. Existing APIs retain their contracts. New `/api/trips/[tripId]/decisions` authenticates membership on every operation and uses narrow SQL RPCs.

UI: `components/group-decisions.tsx`, existing TravelPreferences, TripTools, TripCopilot and ItineraryWorkspace. Candidate proposals link to Group Decisions rather than showing an ordinary Apply button. Studio/Admin/React Flow, published chain definitions and routing precedence are unchanged; existing Admin generation traceability is reused.

## Database installation

One-time scripts, in order: `sql/tripsync3-preferences.sql`, `sql/tripsync3-publication-context.sql`, `sql/tripsync3-decisions.sql`, after TripSync 2. Run as one reviewed transaction. New tables: `trip_decisions`, `trip_decision_options`, `trip_decision_votes`. Existing preference rows gain empty/default extension fields. No reset, existing-record deletion or historical publication edits.

Shared rows have current-member RLS; sensitive writes go through explicit RPCs, never model-generated user IDs. Server-side candidate leases are hidden from client SELECT and removed from readable proposal metadata. Proposal association and voting gates are atomic with persistence/publication. No new credentials: existing Supabase configuration, server-only Gemini key and Studio integration secret are reused.

Expanded preference snapshots safely reject pre-upgrade pending previews. Existing saved versions/ratings are retained; UI comparison normalizes new empty defaults so schema expansion alone is not presented as a traveler editing preferences.

## Local verification

Passed: ESLint, TypeScript, Webpack production build, TripSync 3 domain and real PGlite PostgreSQL/RLS/RPC tests, including changed votes, unanimity/ties, full-electorate majority, deadlines, own-only preferences, exact quote validation, atomic proposal links, old-apply bypass rollback, owner confirmation, immutable history and stale membership/preferences/reservations. The gateway integration test uses the actual regional/Studio SQL and verifies each alternative's publication/run attribution and the selected run's Admin linkage. Its model output is explicitly a fixture, not live AI evidence.

Regression suites passed: TripSync 2 expenses/reservations/chat persistence, Phase 3 manual/scoped publication, Studio, regional routing and prompt context. Route behavior tests were updated for the shared proposal-service extraction; the prior behavior assertions remain in place.

## Live audit and evidence

Before migration: 19 trips, 36 versions, 500 itinerary items, 16 preference submissions, 4 chat messages, 2 reservations, 3 expenses and 9 chain publications. No decision tables existed. Publication fingerprint `7c94b116efc8d23014526b4388b59794`. Existing preference policies permit only current members to read shared preferences and only the author to edit them.

Existing-record fingerprints before migration:
- Preferences (original columns): `3a21bf0c65124d7ab0b24733570937bf`
- Versions: `db681078b1a6772ff8759306b3d2eba5`
- Items: `0c1aaf446582d18125d2ca985945a8ee`
- Chat: `083cbb8c44b89c810d50b434ace5e8b0`
- Reservations: `6a67588b52c7220f166ecea5defbc08c`
- Expenses: `8e80ce471df81139c098ceec0c653126`

Production migration/deployment and real browser results will be recorded below only after verification.

## Limits and follow-up

Actual distinct signed-in member/nonmember accounts are required to complete deployed group participation and authorization tests; do not count solo testing as multiple people. Automated database tests use distinct fixture identities and are clearly separated from live results.

Rules cover explicit structured choices and availability, not every possible free-text semantic disagreement. AI quotes are verified, but the interpretation still needs member confirmation. An itinerary schema cannot verify real-world feasibility; human review of hard constraints and uncertainties is required. Incompatible availability blocks generation until dates or member availability are resolved. Majority voting never changes an individual's saved hard constraints.

Up to 100 eligible members per round; history UI loads the most recent 20 rounds while older records remain stored. Copilot bounds recent metadata and explicit decision context to its existing 90,000-character context limit. No private anonymous ballots, automatic deadline extension, automatic preference rewriting, cross-currency budget conversion or supplier inventory changes are included.

### Migration result

The three scripts committed successfully in one live Supabase transaction. All six pre-existing record fingerprints above match exactly after migration; the nine immutable chain publications retain the same fingerprint. All three new decision tables have RLS enabled. No live traveler preferences, votes, itinerary versions, chats, reservations or expenses were manufactured or rewritten by the migration.
