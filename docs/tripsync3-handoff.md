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

Production migration succeeded; verified deployment and real browser results follow below.

## Limits and follow-up

Actual distinct signed-in member/nonmember accounts are required to complete deployed group participation and authorization tests; do not count solo testing as multiple people. Automated database tests use distinct fixture identities and are clearly separated from live results.

Rules cover explicit structured choices and availability, not every possible free-text semantic disagreement. AI quotes are verified, but the interpretation still needs member confirmation. An itinerary schema cannot verify real-world feasibility; human review of hard constraints and uncertainties is required. Incompatible availability blocks generation until dates or member availability are resolved. Majority voting never changes an individual's saved hard constraints.

Up to 100 eligible members per round; history UI loads the most recent 20 rounds while older records remain stored. Copilot bounds recent metadata and explicit decision context to its existing 90,000-character context limit. No private anonymous ballots, automatic deadline extension, automatic preference rewriting, cross-currency budget conversion or supplier inventory changes are included.

### Migration result

The three scripts committed successfully in one live Supabase transaction. All six pre-existing record fingerprints above match exactly after migration; the nine immutable chain publications retain the same fingerprint. All three new decision tables have RLS enabled. No live traveler preferences, votes, itinerary versions, chats, reservations or expenses were manufactured or rewritten by the migration.


### Verified production release

Deployed code: `c885dbe0e0706d608e2de46e1fc63de8426806c4` on branch `codex/tripsync3-group-decisions`. Vercel deployment `dpl_8dpWbrXANxobMVm78uPeMmovmm6S` reached READY. Stable URL: https://cynthiaaajin-coms6998-designgenai.vercel.app. Immutable URL: https://cynthiaaajin-coms6998-designgenai-41gg3zacl.vercel.app. This handoff/evidence commit is documentation only; the deployed code SHA above is authoritative.

### Real deployed browser results (one authorized account)

Created private trip 32, `[TEST] TripSync 3 Solo Decision QA`, Paris, December 12–13, 2026. Saved structured preferences: EUR 300 per-person-trip, relaxed pace, cafés/historic neighborhoods, museums nice-to-have, nightlife avoid, vegetarian meals, walking/Metro, availability matching the trip, and no activities before 10:00/no nightlife. No second participant or disagreement was fabricated. The interface explicitly labeled the round solo, detected no explicit conflicts, and disabled free-text interpretation requiring two distinct submissions.

Generated the initial itinerary through the actual published Europe chain. Created decision `f20a76a0-7f42-4a2a-9db1-3fa3d4d83839` for Day 2 with two distinct alternatives. Both actual chain executions completed and produced schema-valid before/after previews with supported preferences, tradeoffs and explicit unverified hours/prices/tickets/weather. All proposed starts were after 10:00; vegetarian and no-nightlife preferences appeared in the actual outputs. Neither generation published a version. Voting opened only after separately reviewing and confirming both alternatives.

Changed the one real vote from neighborhood route to museum/café and back. Exactly one vote remained stored, with counts moving to the selected option. The owner publication button remained disabled until its separate constraint/uncertainty authorization checkbox was checked. Confirmation created Version 2 only once:

| Record | Verified ID |
| --- | --- |
| Parent Version 1 | `eb547bfa-c3ee-42b1-a291-4d0de451e6fc` |
| Applied Version 2 | `9097a748-f836-4d2a-9ad3-b9833541112f` |
| Selected neighborhood proposal | `8dc3afe0-b69d-4327-aca3-18563c621f7e` |
| Selected run | `5bc9cab5-e432-46a1-88ff-e79474112db8` |
| Unselected museum/café proposal | `3833ae60-51ba-4a84-b71b-5e87e25ba2a2` |
| Unselected run | `38f896df-85aa-4f0b-81a0-d3c93167a9f1` |
| Actual Europe publication for all three runs | `61d2dac6-0e45-4942-978f-08481558b674` |

Read-only production SQL verified the exact V2 parent, unchanged Day 1 content (all item fields excluding new row/version IDs and creation timestamps), one persisted vote, applied snapshot with threshold 1 and counts 1/0, and the original V1 4/5 rating/comment unchanged. V2 has no copied rating. Only the chosen run acquired V2; the other candidate remains unapplied. Reload retained applied history and removed vote/publication controls from that closed round.

The real deployed Copilot explained the explicitly requested saved decision, reporting applied V2, a one-member solo electorate, threshold 1, actual option counts 1/0, and no recorded personal voting motives. It did not create another itinerary. Admin Generations displayed the real Europe v1 publication, both completed candidate attempts, the selected V2 link, the other candidate as not applied, and V1's preserved 4/5 feedback.

Read-only regression observations: existing trip 31 reservations load; its expense ledger shows EUR 64.25 and USD 10.01 separately, three finalized records and two snapshots. This reflects the current live ledger; no previous-trip data was edited in this QA. Anonymous decision GET returned 401 and cross-origin POST returned 403; existing anonymous chat/expense endpoints returned 401. These do not substitute for signed-in nonmember authorization tests.

Screenshots: `docs/tripsync3-evidence/solo-decision-copilot.png` (390px responsive preview) and `docs/tripsync3-evidence/group-decisions-desktop.png` (desktop pane with Group Decisions and actual explanation). Native browser screenshots were downloaded, copied unchanged and visually inspected. Normal desktop viewport was restored afterward; no claim of full mobile touch interaction testing is made.

### Blocked live cases and remaining limitations

No authorized distinct member/nonmember account was available. Independent preference submission, real multi-person conflict confirmation, independent live ballots, deployed multi-person unanimity/majority/tie/deadline behavior and signed-in nonmember isolation remain **blocked live tests**. Distinct-identity PostgreSQL/RLS/RPC tests passed for these rules, but they are not real-user participation. The completed live round is strictly a solo test.

Existing unrelated tracked document changes exactly match the pre-task patch; all 24 archived pre-existing untracked files match byte-for-byte. Admin and Studio code/publications were not changed. Recoverable checkpoint bundle and untracked archive remain in `/private/tmp/tripsync3-before.bundle` and `/private/tmp/tripsync3-untracked-before.tar.gz`; checkpoint manifests/patch remain under `docs/checkpoints/tripsync3`. Temporary local migration review server was stopped after use.
