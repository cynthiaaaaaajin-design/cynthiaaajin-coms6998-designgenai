// Local checks only: fake Supabase/Gemini adapters, no network or database writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(path, dependencies = {}, globals = {}) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(source, {
    exports: loaded.exports, module: loaded,
    require: name => {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
      return dependencies[name];
    },
    Response, Request, URL, console, ...globals,
  });
  return loaded.exports;
}
const helpers = load('../lib/itinerary.ts');
const activity = { day_number: 1, position: 0, start_time: '09:30', title: 'Museum', description: 'Explore the collection.', location: 'City center' };
const validResponse = JSON.stringify({ activities: [activity] });
assert.equal(helpers.validTripId('9223372036854775807'), true);
assert.equal(helpers.validTripId('9223372036854775808'), false);
assert.equal(helpers.validTripId('1.5'), false);
assert.equal(helpers.tripDayCount('2026-03-07', '2026-03-09'), 3);
assert.throws(() => helpers.tripDayCount('2026-02-30', '2026-03-03'));
assert.throws(() => helpers.tripDayCount('2026-10-10', '2026-10-09'));
assert.throws(() => helpers.parsePreferences({ budget: ' ', interests: 'food' }));
assert.throws(() => helpers.parsePreferences({ budget: 'USD 100', interests: 'x'.repeat(2001) }));
assert.equal(helpers.parseActivities(validResponse, 1)[0].title, 'Museum');
for (const text of ['not JSON', '{"activities":[]}', JSON.stringify({ activities: [activity, activity] }), JSON.stringify({ activities: [{ ...activity, start_time: '25:00' }] })]) {
  assert.throws(() => helpers.parseActivities(text, 1));
}
assert.throws(() => helpers.parseActivities(validResponse, 2));

async function scenario(options = {}) {
  const calls = [];
  let generatedPrompt;
  const client = {
    auth: { getUser: async () => ({ data: { user: options.signedOut ? null : { id: 'owner' } } }) },
    from(table) {
      const query = { table, operation: 'select', filters: [] };
      const chain = {
        select() { return chain; },
        eq(key, value) { query.filters.push([key, value]); return chain; },
        order() { return chain; }, limit() { return chain; },
        insert(payload) { query.operation = 'insert'; query.payload = payload; return chain; },
        update(payload) { query.operation = 'update'; query.payload = payload; return chain; },
        maybeSingle() { return finish(); }, single() { return finish(); },
        then(resolve, reject) { return finish().then(resolve, reject); },
      };
      async function finish() {
        calls.push(query);
        if (query.operation === 'update') return { data: options.responseError ? null : { id: 'new-version' }, error: options.responseError === 'denied' ? { code: '42501' } : null };
        if (table === 'trips') return { data: options.notOwner ? null : { title: 'Holiday', destination: 'Paris', start_date: '2026-10-10', end_date: '2026-10-10' } };
        if (table === 'itinerary_versions' && query.operation === 'select') return { data: options.existing ? { id: 'existing-version' } : null, error: options.readError ? { code: '42501' } : null };
        if (table === 'itinerary_versions') return { data: options.versionError ? null : { id: 'new-version' }, error: options.versionError ? { code: options.versionError } : null };
        return { error: options.itemsError ? { code: '42501' } : null };
      }
      return chain;
    },
  };
  const { POST } = load('../app/api/trips/[tripId]/generate/route.ts', {
    '@/lib/supabase/server': { createClient: async () => client },
    '@/lib/itinerary': helpers,
    '@/lib/gemini-errors': { logGeminiError: async () => 'gemini_unavailable', geminiErrorDetails: async error => ({ name: error.name, message: error.message }) },
    '@/lib/gemini': { generateItinerary: async (prompt, days, captureResponse) => {
      assert.ok(calls.some(call => call.operation === 'insert' && call.table === 'itinerary_versions'), 'Prompt saved before Gemini');
      if (options.invalidOutput) captureResponse(options.invalidOutput);
      generatedPrompt = prompt;
      if (options.geminiError || options.invalidOutput) throw new Error('Gemini unavailable');
      return { responseText: validResponse, activities: [activity] };
    } },
  });
  const response = await POST(new Request('http://localhost/api/trips/9223372036854775807/generate', {
    method: 'POST', headers: { origin: options.foreignOrigin ? 'https://other.example' : 'http://localhost' },
    body: options.badBody ? '{' : JSON.stringify({ budget: 'USD 100 per day', interests: 'art', avoid: 'crowds', instructions: 'Relaxed pace' }),
  }), { params: Promise.resolve({ tripId: '9223372036854775807' }) });
  return { response, body: await response.json(), calls, generatedPrompt };
}
for (const [options, status] of [
  [{ signedOut: true }, 401], [{ notOwner: true }, 404], [{ foreignOrigin: true }, 403],
  [{ readError: true }, 500], [{ badBody: true }, 400],
]) {
  const result = await scenario(options);
  assert.equal(result.response.status, status);
  assert.equal(result.calls.some(call => call.operation === 'insert'), false);
}
const existing = await scenario({ existing: true });
assert.equal(existing.response.status, 200);
assert.equal(existing.body.existing, true);
assert.equal(existing.generatedPrompt, undefined);
assert.equal(existing.calls.some(call => call.operation === 'insert'), false);
const success = await scenario();
assert.equal(success.response.status, 201);
assert.equal(success.response.headers.get('cache-control'), 'private, no-store');
assert.ok(success.calls[0].filters.some(([key, value]) => key === 'user_id' && value === 'owner'));
const version = success.calls.find(call => call.table === 'itinerary_versions' && call.operation === 'insert').payload;
assert.equal(version.trip_id, '9223372036854775807');
assert.equal(version.version_number, 1);
assert.equal(version.source, 'ai_initial');
assert.equal(version.created_by, 'owner');
assert.equal(version.prompt_text, success.generatedPrompt);
assert.equal(version.response_text, null);
assert.equal(success.calls.find(call => call.operation === 'update').payload.response_text, validResponse);
for (const part of ['Paris', '2026-10-10', 'USD 100 per day', 'art', 'crowds', 'Relaxed pace']) assert.ok(version.prompt_text.includes(part));
const items = success.calls.find(call => call.table === 'itinerary_items').payload;
assert.equal(items.length, 1);
assert.equal(items[0].version_id, 'new-version');
assert.equal(items[0].origin, 'ai');
assert.equal(items[0].title, 'Museum');
const failedVersion = await scenario({ versionError: '42501' });
assert.equal(failedVersion.response.status, 500);
assert.equal(failedVersion.calls.some(call => call.table === 'itinerary_items'), false);
assert.equal((await scenario({ versionError: '23505' })).response.status, 409);
const failedItems = await scenario({ itemsError: true });
assert.equal(failedItems.response.status, 500);
assert.match(failedItems.body.error, /response was saved/);
console.log('PASS: validation, owner authorization, existing-version preservation, exact prompt/response persistence, bulk activity insert, and failure paths.');

// Error diagnostics: no live key, provider calls, or database access.
const logs = [];
const testEnv = { NODE_ENV: 'development', GEMINI_API_KEY: 'test-secret-key' };
const diagnostics = load('../lib/gemini-errors.ts', { 'server-only': {} }, {
  process: { env: testEnv }, console: { error: (...args) => logs.push(args) },
});
for (const [error, category] of [
  [{ code: 'MISSING_API_KEY' }, 'missing_api_key'],
  [{ status: 400, message: 'API key not valid. Please pass a valid API key.' }, 'invalid_api_key'],
  [{ status: 401 }, 'invalid_api_key'],
  [{ statusCode: 403 }, 'permission_denied'],
  [{ status: 429 }, 'rate_limited'],
  [{ response: { status: 400, data: { error: 'Invalid argument' } } }, 'invalid_request'],
  [{ status: 404 }, 'model_not_found'],
  [{ status: 503 }, 'gemini_unavailable'],
  [{ message: 'fetch failed' }, 'gemini_unavailable'],
  [new Error('Unrecognized failure'), 'unknown_error'],
]) assert.equal(await diagnostics.logGeminiError(error, 'test'), category);
const diagnosticError = {
  name: 'ApiError', message: 'Failed with test-secret-key', status: 403, statusCode: 403,
  details: { reason: 'PERMISSION_DENIED', apiKey: 'another-secret' },
  response: new Response('Provider body: test-secret-key', { status: 403 }),
  stack: 'development stack test-secret-key',
};
await diagnostics.logGeminiError(diagnosticError, 'Gemini call');
const [prefix, developmentLog] = logs.at(-1);
assert.equal(prefix, '[Gemini generation error]');
const development = JSON.parse(developmentLog);
assert.equal(development.name, 'ApiError');
assert.equal(development.status, 403);
assert.equal(development.statusCode, 403);
assert.equal(development.responseBody, 'Provider body: [REDACTED]');
assert.equal(development.details.reason, 'PERMISSION_DENIED');
assert.equal(development.stack, 'development stack [REDACTED]');
assert.ok(!developmentLog.includes('test-secret-key'));
assert.ok(!developmentLog.includes('another-secret'));
testEnv.NODE_ENV = 'production';
await diagnostics.logGeminiError(diagnosticError, 'Generation API route');
assert.equal('stack' in JSON.parse(logs.at(-1)[1]), false);
const safeFailure = await scenario({ geminiError: true });
assert.equal(safeFailure.body.category, 'gemini_unavailable');
assert.equal(safeFailure.body.error, 'AI generation failed. Please try again later.');
console.log('PASS: Gemini error categories, response details, key redaction, development-only stacks, and generic client errors.');

let capturedRequest;
let providerFailure;
let providerText = validResponse;
let finishReason = 'STOP';
const stages = [];
const gemini = load('../lib/gemini.ts', {
  'server-only': {},
  '@google/genai': { GoogleGenAI: class {
    models = { generateContent: async request => {
      capturedRequest = request;
      if (providerFailure) throw providerFailure;
      return { text: providerText, candidates: [{ finishReason }] };
    } };
  } },
  './itinerary': helpers,
  './gemini-errors': { logGeminiError: async (error, stage) => stages.push({ error, stage }) },
}, { process: { env: { GEMINI_API_KEY: 'test-only-key' } } });
await gemini.generateItinerary('unchanged prompt', 1);
assert.equal(capturedRequest.model, 'gemini-3.8-flash');
assert.equal(capturedRequest.contents, 'unchanged prompt');
assert.equal(capturedRequest.config.maxOutputTokens, 16000);
assert.equal(capturedRequest.config.httpOptions.timeout, 90000);
assert.equal('responseMimeType' in capturedRequest.config, false);
assert.equal('responseJsonSchema' in capturedRequest.config, false);
const format = capturedRequest.config.httpOptions.extraBody.generationConfig.responseFormat;
assert.equal(format.text.mimeType, 'APPLICATION_JSON');
assert.equal('maxItems' in format.text.schema.properties.activities, false);
assert.equal(format.text.schema.properties.activities.minItems, 1);
assert.equal(format.text.schema.properties.activities.items.additionalProperties, false);
assert.throws(() => helpers.parseActivities(JSON.stringify({ activities: Array.from({ length: 121 }, (_, position) => ({ ...activity, position })) }), 1));
providerFailure = Object.assign(new Error('Invalid argument'), { status: 400 });
await assert.rejects(gemini.generateItinerary('unchanged prompt', 1), error => error === providerFailure);
assert.equal(stages.at(-1).stage, 'Gemini structured generation (responseFormat)');
console.log('PASS: current structured request shape, preserved prompt/config, server-side activity cap, and failing-stage logging.');

for (const options of [{ geminiError: true }, { invalidOutput: '{"activities":' }]) {
  const result = await scenario(options);
  assert.equal(result.response.status, 502);
  const attempt = result.calls.find(call => call.operation === 'insert' && call.table === 'itinerary_versions');
  assert.equal(attempt.payload.prompt_text, result.generatedPrompt);
  const completion = result.calls.find(call => call.operation === 'update');
  assert.ok(completion.filters.some(filter => filter.includes('id') && filter.includes('new-version')));
  const stored = JSON.parse(completion.payload.response_text);
  assert.equal(stored.response_text, options.invalidOutput ?? null);
  assert.ok(stored.error.message);
  assert.ok(!result.calls.some(call => call.table === 'itinerary_items' && call.operation === 'insert'));
}
for (const responseError of ['denied', 'no rows']) {
  const result = await scenario({ responseError });
  assert.equal(result.response.status, 500);
  assert.match(result.body.error, /prompt was saved/);
  assert.ok(!result.calls.some(call => call.table === 'itinerary_items' && call.operation === 'insert'));
}
assert.equal((await scenario({ versionError: '42501' })).generatedPrompt, undefined);
console.log('PASS: prompt saved before every call, failed attempts preserved, and result persistence failures surfaced.');

providerFailure = undefined;
for (const [text, reason] of [['not JSON', 'STOP'], ['{"activities":[]}', 'STOP'], ['partial response', 'MAX_TOKENS'], ['', 'SAFETY']]) {
  providerText = text;
  finishReason = reason;
  let captured;
  await assert.rejects(gemini.generateItinerary('exact prompt', 1, raw => { captured = raw; }));
  assert.equal(captured, text);
  assert.equal(stages.at(-1).stage, 'Gemini response validation');
}
const storedError = await diagnostics.geminiErrorDetails(diagnosticError, 'failed attempt');
assert.equal(storedError.responseBody, 'Provider body: [REDACTED]');
assert.equal('stack' in storedError, false);
assert.ok(!JSON.stringify(storedError).includes('test-secret-key'));
console.log('PASS: malformed, invalid, truncated and blocked output captured before validation; stored diagnostics redact secrets.');
