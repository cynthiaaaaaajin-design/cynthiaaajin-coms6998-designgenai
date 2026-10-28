# Active TripSync prompt configuration

Applied to the connected database on October 28, 2026. `sql/tripsync-prompt-context.sql` requires the existing Week 7 observability migration. The initial seed uses fixed IDs and does not duplicate those records when repeated, but rerunning can reset an original mix weight of 1 to 3; do not rerun on the connected project.

## Examples and terms

Two enabled examples demonstrate structured JSON rather than claiming real itinerary availability:

- itinerary: one slow-paced day in Lisbon with two nearby stops, explicit budget scope and no claimed bookings.
- proposal: replace only one Day 2 afternoon activity in Madrid because of rain; preserve the revision scope and include uncertainties.

Five enabled glossary entries define hard constraints, slow-paced travel, daily budgets, travel buffers and unverified availability. Each uses `kind: all` so both generation types can interpret it when relevant.

Only references with `enabled: true` are used. Terms must have `kind: all`, `itinerary` or `proposal`; examples must match exactly `itinerary` or `proposal`. Legacy records without an explicit enabled flag remain unused. Up to eight terms and two examples per generation kind are included, ordered by creation time and ID. Disable an old reference before adding a replacement beyond those caps.

New generation prompts include the chain's template, bounded glossary and example reference data, followed by the actual request. The actual request's schema, scope and traveler constraints take precedence. This is prompt context, not model training and not a guarantee of output quality. The request log captures the chosen chain name, IDs and exact reference snapshots for later diagnosis. Existing itineraries do not change.

## Steps and mix

The runtime supports one model call per chain. Each chain must contain exactly one step; it uses the step's model reference and prompt template. Multiple rows are explicitly rejected rather than silently ignoring later steps. Chain and step pages remain read-only as required by the assignment. Adding new strategies or a multi-call workflow requires a migration or runner change, not an extra row in the read-only UI.

The new `itinerary-nearby` chain prefers nearby activities and avoids unnecessary cross-city transfers while retaining the requested pace, activity count and constraints. It uses the existing Gemini adapter/model.

The seeded original itinerary weight is 3 (only its old default weight of 1 is changed); nearby is 1. With these two enabled candidates, expected selection is about 75% / 25% over many requests, not an exact schedule. Proposal is a separate kind and remains the only proposal candidate. Disabling all candidates for one kind makes that kind unavailable; the runtime does not bypass the mix.

Admin Chain mix shows each strategy's name, weight and enabled state. Edit an existing entry to change its relative weight or turn it off. The enabled checkbox controls eligibility; the weight must remain positive. For an all-nearby trial, disable the original itinerary entry while keeping nearby enabled. Re-enable the original to restore the comparison.

## Verification

`node scripts/verify-prompt-context.mjs` passes isolated database tests for context selection, kind separation, reference edits/disabling, audit snapshots, alternate routing, no-enabled-chain failure and multi-step rejection. Admin security tests, lint and webpack production build passed.

A live rollback-only call to `begin_observed_generation` verified that glossary, itinerary example and the actual Paris request all appear in the assembled prompt. No model was called, no generated output quality was measured, and the temporary request was rolled back.
