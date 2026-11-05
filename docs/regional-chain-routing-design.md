# Regional chain routing — proposed architecture

Status: inspection and design only. No feature code, migration, production configuration changes, Gemini calls, or deployments were performed for this request. Implementation requires architecture approval and confirmation that the current assignment was safely submitted.

## Verified current architecture

- Studio stores editable steps in `studio_chains`; `studio_runs` holds test snapshots. `studio_publish_chain` checks a successful test of the exact revision and creates/reuses an immutable `studio_chain_versions` row.
- Publishing currently also overwrites the single `studio_integration_config.active_version_id` for `trip-planning`. Publishing another chain therefore changes the global selection today.
- Public `lib/published-chain.ts` calls `studio_gateway('begin')`. That RPC checks the traveler, trip permissions and server integration credential, selects the global publication, and inserts a `studio_trip_runs` row before returning its snapshot. The shared runtime executes those saved steps. Both initial generation and revision use this path; revision retains its existing proposal schema and scope validation.
- Subsequent step writes load the publication through the saved run's `publication_id`. This is the correct immutable boundary to preserve.
- Admin `/generations` calls `studio_admin_generations`, joins exact publication and itinerary IDs, and displays actual feedback. Its current `is_active` flag compares against one global pointer and must be extended for routing.
- Public `lib/destinations.ts` has exact aliases for a small curated destination list, with country display names rather than a complete ISO-coded country resolver. Unknown input is not geographically resolved. Existing Google Places photo code does not request structured country address components and is not a routing resolver.

## Proposed model

Keep the existing runtime, immutable publications and historical run references. Add only:

1. `studio_chain_heads`: one row per chain, pointing to its independently active tested publication. Publication ID must belong to that chain and have the itinerary contract. All head updates require superadmin authorization.
2. `studio_routing_rules`: stable ID, name, explicit ISO alpha-2 country-code array, priority, enabled flag, assigned chain ID and update audit fields. One explicitly configured fallback row has no country filter. A database constraint permits exactly one enabled fallback at most; enabling routing requires one valid fallback. Lower priority number wins; enabled non-fallback priorities are unique. Cross-rule country overlaps are permitted, visibly flagged, and resolved by priority.
3. Nullable `routing_decision` JSONB on `studio_trip_runs`, plus a disabled-by-default routing flag in the existing integration configuration. Decision fields are validated by the gateway, not accepted as arbitrary traveler JSON.

Old records keep their existing publication IDs and null routing metadata, displayed as **Legacy global selection**, without inventing their historical country or routing rule.

### Publication and rollout behavior

Introduce a separate regional publication RPC rather than silently changing the existing RPC during migration. It retains all current exact-revision test and output validation, then updates only the selected chain's head. A Studio feature flag chooses the new API only after all three apps are compatible.

Seed only the current global publication as its chain head and explicit fallback. Create the regional rules disabled and unassigned. Do not activate a latest historical publication automatically. Retain the old global pointer as the rollback target; regional publishing must not overwrite it.

Routing-off execution continues to use the old global selection. Routing-on execution uses the independent heads. UI labels distinguish **Published for this chain**, **Assigned routes**, and **Global fallback**; there is no misleading single global Active label for all regional chains.

## Destination resolution and routing

Resolve on the server from the trip's stored destination, not from the prompt text or a traveler-supplied country field. Reuse a verified structured place identity if available. For current free-text trips, use an explicit reviewed exact-alias mapping for supported fixtures, or Google Places structured country components after validating a geographic destination match. Do not use a substring or simply take the first search result. Ambiguous names such as Springfield without a qualifying place must remain unresolved; request clarification or use an explicitly labeled valid fallback.

Google Place Details exposes `addressComponents` through an explicit field mask. Its `regionCode` request parameter is a formatting/bias parameter and must not be treated as the resolved country. API errors, quota limits, mismatched geographic identity, multiple plausible countries and missing country components produce a distinct unresolved reason. Test routing may make a bounded Places lookup; it never invokes Gemini. Review provider retention and attribution requirements before persisting resolver data; no raw provider payload is needed.

Proposed initial service scopes (product definitions, not an automatic continent classifier):

- **North America:** `CA, US, MX`. Label the exact scope in the UI; this initial template does not silently cover every geographic territory in North America.
- **Europe:** `AD, AL, AT, BA, BE, BG, BY, CH, CY, CZ, DE, DK, EE, ES, FI, FR, GB, GR, HR, HU, IE, IS, IT, LI, LT, LU, LV, MC, MD, ME, MK, MT, NL, NO, PL, PT, RO, RS, SE, SI, SK, SM, UA, VA`. This deliberate initial service list includes Cyprus; other transcontinental destinations and territories use fallback unless explicitly added.
- **Mainland China:** `CN` only. `HK, MO, TW` remain separate and use fallback unless assigned their own rules. If a provider's structured result cannot distinguish the requested service area reliably, leave it unresolved rather than applying the mainland rule.
- **Global fallback:** every unmatched or unresolved destination, with the reason visible.

At run start:

1. Authenticate traveler and server credential and check trip/version access as today.
2. Confirm the resolved destination corresponds to the currently stored trip destination; reject/retry if it changed during resolution.
3. Select the highest-priority enabled matching rule exactly once. Resolve its chain head; if missing/invalid, use only the explicitly configured valid fallback. Do not silently try a lower-priority regional rule.
4. If fallback is also unavailable, fail clearly before Gemini or itinerary mutation.
5. In one database transaction, store exact publication ID and decision snapshot on the run, then return that publication snapshot. Later publication/rule updates cannot change this run.

Decision snapshot: schema version, destination text, resolution status/source, country code or null, matched rule ID/name/priority, actual selected chain ID, exact publication ID, fallback boolean/reason, and selection timestamp. Preserve the matched regional rule separately when a missing regional publication causes global fallback, so attribution remains honest even if rules are later edited or deleted.

**Revision policy:** each new revision uses the current routes for the trip's current stored destination, then pins its decision for that run. It does not inherit an old publication implicitly. Admin shows both the base itinerary and the new run's publication. Multi-country trips initially use global fallback with `multi_country` reason unless every resolved stop selects the same rule; ambiguous stop parsing never guesses a single country.

## Studio and Admin UX

Studio gets a **Chain Routing** panel with scope chips, priority, assigned chain, exact active publication, fallback, and visible missing/overlapping assignment warnings. Updating routing is separate from editing prompts. A destination input and **Test routing** button call the same resolver and database selection function used by generation, in read-only preview mode. Return country, resolution state, matched rule, actual selection and fallback reason without creating a generation.

Create three editable templates using unique `template_key` values and insert-on-conflict-do-nothing. Never overwrite an existing chain. Each retains the current three-step pattern and validated itinerary output contract. Region instructions are scoped to destination context, avoid transport assumptions and live availability claims, and preserve explicit traveler constraints. Templates start unpublished; a successful real validation is required before independent publication and assignment.

Admin adds country/service scope, routing decision and fallback reason alongside its existing exact publication link, execution status, saved itinerary version and actual rating. Historical routing snapshots remain unchanged after route edits. Public shows a concise fallback warning when resolution is uncertain, without exposing private prompt content.

## Security and migration plan

All new table access is revoked from anon/travelers by default, with superadmin-only configuration RPCs and RLS. Traveler generation remains behind both server credential and traveler JWT; no client may select a publication or forge a resolved country. Fixed search paths, explicit grants, ownership checks, payload bounds, and concurrency protections remain.

Prepare additive SQL and run it first in isolated PostgreSQL/PGlite. Validate unchanged legacy gateway execution before applying it to production. Deploy backward-compatible apps with routing disabled, seed templates and validate publications, preview all routes, then enable routing deliberately. Rollback disables routing to the retained global pointer; it does not delete new runs, publications, ratings or schema.

High risks: accidental global pointer replacement, uncertain destination matches, rule changes during execution, missing assignments, proposal-schema regressions and misleading active-version labels. Independent heads, explicit unknown handling, atomic run selection, valid fallback checks and historical decision snapshots address these risks. Existing Gemini timeout behavior remains; do not mask it as a routing failure.

## Required verification after approval

No regional feature tests have been run yet. Planned tests:

- Unit/integration: explicit ISO scopes, overlap precedence, unknown/ambiguous and multi-country cases, HK/MO/TW exclusion, missing regional/global publication, trip destination race, exact-once selection, permission failures, idempotent templates, concurrent publication, legacy compatibility, and immutable historical attribution.
- Live routing preview: Paris → FR/Europe; New York → US/North America; Shanghai → CN/Mainland China; Tokyo → JP/global; unknown → unresolved/global warning or explicit validation failure. No Gemini for previews.
- Actual Gemini generations for Paris, New York and Shanghai; inspect exact database publication and decision records, saved itinerary schema and Admin feedback links. Add one actual revision proving the declared current-routing policy, plus independent-publication/draft-isolation/historical-snapshot checks. Do not infer routing from generated wording.
- Use only authorized Cynthia superadmin and YJ ordinary sessions. Follow this request's clearly marked, isolated test-trip requirement after submission; do not relabel or delete existing normal trips. Ratings are real test-account actions and must be described as such.
- Run each app's appropriate tests, lint, TypeScript and production build; check deployed login, superadmin rejection, mobile and appearance modes. Report executed pass/fail, provider errors and any untested cases separately.

Source reference for the proposed resolver: https://developers.google.com/maps/documentation/places/web-service/place-details

## Approval boundary

This document is reviewable preparation only. It is not evidence that regional routing exists. Before implementation, confirm the assignment has been safely submitted and approve the service-country scopes, independent-publication design and revision policy. Production schema/configuration changes and a later rollout must follow the approved scope. No changes to Chucklesome are included.
