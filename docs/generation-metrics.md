# Generation metrics

Both main-app and Admin itinerary/proposal generation capture:

- `model`: the resolved model identifier actually passed to the Gemini API, after environment-default resolution.
- `model_version`: the response's `modelVersion`, when supplied.
- `duration_ms`: elapsed application time from before generation configuration through SDK response validation, before completion logging; it is not an isolated provider-compute measurement.
- Input, candidate output, total, thinking and cached input tokens from Gemini `usageMetadata`.

The provider's total is retained rather than recalculated: it may include thinking/tool tokens. Missing metadata is `null`; a real count of zero remains zero. Provider exceptions record the resolved model and elapsed time without inventing usage. A response rejected by itinerary validation still retains its returned usage metadata.

Admin Requests displays Model, Duration and Tokens columns. Raw request/response/output records also expose the metrics snapshot. Old records are left unchanged and show Not recorded, without guessing a historical model or token count.

`sql/generation-metrics.sql` adds an owner-checked atomic completion RPC. It validates metric types and bounds, delegates the existing success/failure logging, and updates the linked metrics in the same transaction. It is already applied to the connected Supabase project; do not rerun it there. If app code rolls out before the function exists, the helper falls back to the original completion RPC only for a missing-function error.

Verification: both apps passed lint and production webpack builds. `npm run test:metrics` passes mocked SDK tests covering itinerary/proposal success, validation errors and provider failures; isolated PostgreSQL tests cover atomic persistence, missing usage, bounds, ownership and replay denial. The SDK field mapping was checked against the installed @google/genai declarations. The user requested skipping the final real model call; no real token usage or latency result is claimed for this change.

Deploy both repositories to collect and display metrics on new requests. Existing public deployments do not contain these code changes until redeployed.
