# Receipt-assisted trip expenses

Implemented November 14, 2026. Consumer TripSync only. Video script remains unchanged.

## User flow

Open a trip → Expenses → Add an expense. Each current participant can upload a JPEG, PNG or WebP receipt/payment screenshot up to 2 MB. Recognition starts automatically after choosing the image; Read receipt with AI remains available for retry. Gemini extracts a short description, final total, currency, date and category into an editable draft. Unknown fields remain empty and warnings identify uncertainty. The user chooses the actual payer, expense participants and split method, corrects any fields, and explicitly checks the review confirmation before saving. Editing a field invalidates that confirmation. Manual entry is always available, including after a recognition error.

Recognition never saves an expense. The image is transmitted to Gemini for recognition and is not stored by TripSync. The existing member-authorized expense RPC saves only the confirmed fields; no schema, Storage, RLS or financial records were changed for this feature. Payer defaults to the current signed-in account, not an identity guessed from a receipt. The existing owner/creator edit/delete restrictions remain.

Who owes whom is now shown automatically from every participant's saved open expenses. It refreshes after saving, on window focus/visibility, every 15 seconds while visible, or through Refresh balances. Integer minor-unit calculations and the existing server settlement rules determine exact transfers; the language model does not invent transfer amounts. Currencies stay separate. Nothing sends money. Owner finalization and recipient confirmation remain separate explicit actions; changing expense context invalidates a reviewed settlement, and the database fingerprint still rejects stale finalization.

Example: Cynthia pays USD 60 and YJ pays USD 20, both shared equally by these two people. The resulting recommendation is YJ → Cynthia USD 20.

## Configuration

Reuses server-only GEMINI_API_KEY. Optional GEMINI_RECEIPT_MODEL overrides GEMINI_MODEL for this operation; otherwise it uses the current Gemini fallback. The installed @google/genai responseFormat extraBody compatibility pattern is retained. Reference for inline image parts: https://ai.google.dev/gemini-api/docs/generate-content/image-understanding

## Verified

- Full ESLint passed.
- Webpack production build passed, including TypeScript. An initial build encountered obsolete generated types from the temporary UI preview route; those generated types were moved out of the build tree and the subsequent build passed. The temporary preview route is removed and absent from the production route manifest.
- npm run test:expense-receipts passed: receipt schema validation, invalid/unknown amounts/currencies/dates, MIME/signature/base64 validation, request byte bounds including streamed bodies, auth rejection before provider calls, incomplete/invalid AI response, read-only extraction, and exact two-payer transfer. Auth/provider calls in this suite are fixtures.
- npm run test:tripsync2 passed, including isolated PostgreSQL member isolation, immutable settlement cycles, currency separation, stale-preview rejection, owner finalization and recipient receipts.
- Real headless Chrome UI check passed on the actual components with mocked API/auth/provider responses: recognition failure/retry, edited draft, explicit confirmation reset, both payer defaults, separate simulated account submissions, automatic cross-window refresh, manual-entry form, and no horizontal overflow at 390px.
- A separate actual Gemini call through the new route's provider logic read a synthetic demo image as Boston Cafe, USD 60.00, 2026-11-14, Food & Drinks, and correctly warned that it was a synthetic receipt. Authentication was stubbed for this isolated recognition check; no live expense was created.
- Desktop and mobile screenshots were visually inspected. Reproducible temporary UI driver, synthetic receipt, screenshots and the real model result are in /private/tmp/tripsync-receipt-qa.

## Limits

Live independent-account uploads and persistence on the deployed site still need verification in the two actual signed-in browser windows. Mocked UI accounts are not evidence of live two-user participation. Recognition is best-effort and requires review; screenshots showing multiple payments, ambiguous currency or unclear dates may require manual entry. Receipts are processed one at a time and are not archived or deduplicated. Add a shared receipt once, rather than having every traveler add the same bill. Transfers use confirmed open expenses only; this does not assume that everyone has finished adding expenses.

## Production release

Final application commit: `1563b76cacae93ada098f0c2c342410a1b73b786`, pushed on `codex/receipt-split-bill`. Deployed from a clean detached worktree; existing unrelated local documents were excluded. Deployment `dpl_6hqH47uTEuUpMpn6NHvGxmiRqiew` reached READY. Stable URL: https://cynthiaaajin-coms6998-designgenai.vercel.app. Immutable URL: https://cynthiaaajin-coms6998-designgenai-2tcwchdv6.vercel.app.

A real signed-in owner session opened Boston Weekend Together (trip 33), Expenses, and Add an expense on the first deployment. The real current participants loaded as Cynthiaaa Jin and Yuxin Jin; the payer defaulted to the owner. Automated selection of a local synthetic image was blocked because the Chrome extension lacks file URL access. No permission setting was changed, no live expense was saved, and no actual two-account upload completion is claimed. The existing finalization rules and live records were not changed. The later automatic-recognition-on-selection update passed a focused component event test and the production build; it was not retested through the blocked browser upload.

Latest immutable deployment: anonymous receipt POST returns 401; cross-origin receipt POST returns 403. Both retain private/no-store responses. Video script remains untouched. Release metadata is in expense-receipts-release.json.
