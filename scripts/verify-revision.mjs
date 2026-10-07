// Mocked Supabase and Gemini only: no live API calls or database writes.
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
    exports: loaded.exports, module: loaded, Response, Request, URL, console, ...globals,
    require: name => {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
      return dependencies[name];
    },
  });
  return loaded.exports;
}
const feedback = load('../lib/feedback.ts');
const itinerary = load('../lib/itinerary.ts');
const server = load('../lib/feedback-server.ts', { 'server-only': {}, './trip-people': { loadTripPeople: async () => null }, '@/lib/feedback': feedback });
const revision = load('../lib/revision.ts', { './feedback': feedback });
const originalPrompt = itinerary.buildPrompt({ title: 'Paris', destination: 'Paris', start_date: '2026-10-10', end_date: '2026-10-10' }, { budget: 'EUR 100 per day', interests: 'Art', avoid: 'Long hikes', instructions: 'Relaxed pace' }, 1);
const activity = { day_number: 1, position: 0, start_time: '09:00', title: 'Museum', description: 'Explore art', location: 'Paris' };
const items = [{ id: 'old-item', ...activity }];
const rows = [
  { id: '9007199254740992', item_id: 'old-item', user_id: 'owner', value: 1, comment: 'OBSOLETE_COMMENT' },
  { id: '9007199254740993', item_id: 'old-item', user_id: 'owner', value: -1, comment: 'Prefer outdoors' },
  { id: '9007199254740994', item_id: 'old-item', user_id: 'member', value: 1, comment: 'Keep art' },
];
const trip = { destination: 'Paris', start_date: '2026-10-10', end_date: '2026-10-10' };
const prompt = revision.buildRevisionPrompt(trip, originalPrompt, 1, items, rows, 1);
const context = JSON.parse(prompt.split('Revision context:\n')[1]);
assert.equal(context.original_generation_prompt, originalPrompt);
assert.equal(context.previous_itinerary[0].feedback.likes, 1);
assert.equal(context.previous_itinerary[0].feedback.dislikes, 1);
assert.equal(context.previous_itinerary[0].feedback.comments.length, 2);
assert.ok(!prompt.includes('OBSOLETE_COMMENT'));
assert.ok(prompt.includes('Prefer outdoors'));
assert.ok(prompt.includes('Keep art'));
assert.ok(prompt.includes('EUR 100 per day'));
assert.ok(!prompt.includes('9007199254740993'));
assert.ok(!prompt.includes('"user_id"'));

async function scenario(options = {}) {
  const calls = [];
  const logs = [];
  let generatedPrompt;
  const client = {
    auth: { getUser: async () => ({ data: { user: options.signedOut ? null : { id: 'owner' } } }) },
    from(table) {
      const query = { table, operation: 'select', filters: [] };
      const chain = {
        select(columns) { query.columns = columns; return chain; },
        eq(key, value) { query.filters.push(['eq', key, value]); return chain; },
        in(key, value) { query.filters.push(['in', key, value]); return chain; },
        lt(key, value) { query.filters.push(['lt', key, value]); return chain; },
        order(key, value) { query.order = { key, ...value }; return chain; },
        limit(value) { query.limit = value; return chain; },
        insert(payload) { query.operation = 'insert'; query.payload = payload; return chain; },
        update(payload) { query.operation = 'update'; query.payload = payload; return chain; },
        maybeSingle() { query.cardinality = 'maybeSingle'; return finish(); }, single() { query.cardinality = 'single'; return finish(); },
        then(resolve, reject) { return finish().then(resolve, reject); },
      };
      async function finish() {
        calls.push(query);
        if (query.operation === 'update') return { data: options.responseError ? null : { id: 'new-version' }, error: options.responseError === 'denied' ? { code: '42501' } : null };
        if (table === 'trips') return { data: options.notOwner ? null : trip };
        if (table === 'itinerary_versions') {
          if (query.operation === 'insert') return { data: options.versionError || options.emptyInsert ? null : { id: 'new-version' }, error: options.versionError ? { code: options.versionError } : null };
          if (query.filters.some(([, key]) => key === 'id')) return { data: options.hiddenAfterUpdate ? null : { id: 'new-version' }, error: null };
          if (query.filters.some(([, key]) => key === 'source')) return { data: options.missingOriginal ? null : { prompt_text: originalPrompt } };
          return { data: options.noVersion ? null : { id: 'previous-version', version_number: options.versionNumber ?? 1 } };
        }
        if (table === 'itinerary_items') {
          if (query.operation === 'insert') return { error: options.itemsError ? { code: '42501' } : null };
          return { data: options.noItems ? [] : items };
        }
        assert.equal(table, 'activity_votes');
        if (options.votesError) return { error: { code: '42501' } };
        const cursor = query.filters.find(([op]) => op === 'lt')?.[2];
        return { data: (options.noVotes ? [] : rows).filter(row => !cursor || BigInt(row.id) < BigInt(cursor)).sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : 1).slice(0, 2) };
      }
      return chain;
    },
  };
  const { POST } = load('../app/api/trips/[tripId]/revise/route.ts', {
    '@/lib/supabase/server': { createClient: async () => client },
    '@/lib/itinerary': itinerary,
    '@/lib/feedback-server': server,
    '@/lib/revision': revision,
    '@/lib/gemini-errors': { logGeminiError: async () => 'gemini_unavailable', geminiErrorDetails: async error => ({ name: error.name, message: error.message }) },
    '@/lib/gemini': { generateItinerary: async (value, days, captureResponse) => {
      assert.ok(calls.some(call => call.operation === 'insert' && call.table === 'itinerary_versions'), 'Prompt saved before Gemini');
      if (options.invalidOutput) captureResponse(options.invalidOutput);
      generatedPrompt = value;
      if (options.geminiError || options.invalidOutput) throw new Error('Unavailable');
      return { responseText: JSON.stringify({ activities: [activity] }), activities: [activity] };
    } },
  }, { console: { error: (...args) => logs.push(args) } });
  const result = await POST(new Request('http://localhost/api/trips/3/revise', {
    method: 'POST', headers: { origin: options.foreignOrigin ? 'https://other.example' : 'http://localhost' },
    body: JSON.stringify({ user_id: 'forged', parent_version_id: 'forged', version_number: 99 }),
  }), { params: Promise.resolve({ tripId: '3' }) });
  return { status: result.status, body: await result.json(), calls, generatedPrompt, logs };
}
for (const [options, expected] of [
  [{ signedOut: true }, 401], [{ notOwner: true }, 404], [{ foreignOrigin: true }, 403],
  [{ noVersion: true }, 409], [{ noItems: true }, 409], [{ missingOriginal: true }, 500],
  [{ votesError: true }, 500],
]) {
  const result = await scenario(options);
  assert.equal(result.status, expected);
  assert.ok(!result.calls.some(call => call.operation === 'insert'));
  if (!options.geminiError) assert.equal(result.generatedPrompt, undefined);
}
for (const previousNumber of [1, 2, 10]) {
  const result = await scenario({ versionNumber: previousNumber });
  assert.equal(result.status, 201);
  assert.equal(result.body.versionNumber, previousNumber + 1);
  assert.ok(result.calls.find(call => call.table === 'trips').filters.some(([, key, value]) => key === 'user_id' && value === 'owner'));
  const writes = result.calls.filter(call => call.operation === 'insert');
  assert.equal(writes.length, 2);
  const version = writes[0].payload;
  assert.equal(version.version_number, previousNumber + 1);
  assert.equal(version.parent_version_id, 'previous-version');
  assert.equal(version.created_by, 'owner');
  assert.equal(version.source, 'ai_revision');
  assert.equal(version.prompt_text, result.generatedPrompt);
  assert.equal(version.response_text, null);
  assert.equal(result.calls.find(call => call.operation === 'update').payload.response_text, JSON.stringify({ activities: [activity] }));
  assert.equal(writes[1].table, 'itinerary_items');
  assert.equal(writes[1].payload[0].version_id, 'new-version');
  assert.equal(writes[1].payload[0].origin, 'ai');
  assert.equal('id' in writes[1].payload[0], false);
  assert.ok(!writes.some(call => call.table === 'activity_votes'));
}
assert.equal((await scenario({ noVotes: true })).status, 201);
const duplicate = await scenario({ versionError: '23505' });
assert.equal(duplicate.status, 409);
assert.ok(!duplicate.calls.some(call => call.table === 'itinerary_items' && call.operation === 'insert'));
const partial = await scenario({ itemsError: true });
assert.equal(partial.status, 500);
assert.match(partial.body.error, /response was saved/);
console.log('PASS: latest comments/counts, original constraints, owner-only revision, exact prompt/response, increment/parent linkage, fresh activity IDs, no vote copying, and failure paths.');

for (const options of [{ geminiError: true }, { invalidOutput: '{"activities":' }]) {
  const result = await scenario(options);
  assert.equal(result.status, 502);
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
  assert.equal(result.status, 500);
  assert.match(result.body.error, /prompt was saved/);
  assert.ok(!result.calls.some(call => call.table === 'itinerary_items' && call.operation === 'insert'));
}
assert.equal((await scenario({ versionError: '42501' })).generatedPrompt, undefined);
console.log('PASS: prompt saved before every call, failed attempts preserved, and result persistence failures surfaced.');

const emptyInsert = await scenario({ emptyInsert: true });
assert.equal(emptyInsert.status, 500);
assert.equal(emptyInsert.generatedPrompt, undefined);
for (const hiddenAfterUpdate of [false, true]) {
  const failedUpdate = await scenario({ responseError: 'no rows', hiddenAfterUpdate });
  const update = failedUpdate.calls.find(call => call.operation === 'update');
  assert.equal(update.cardinality, 'maybeSingle');
  assert.deepEqual(update.filters, [['eq', 'id', 'new-version'], ['eq', 'trip_id', '3'], ['eq', 'created_by', 'owner']]);
  const diagnostics = failedUpdate.logs.map(([, message]) => JSON.parse(message));
  assert.equal(diagnostics[0].operation, 'update');
  assert.equal(diagnostics[0].table, 'itinerary_versions');
  assert.equal(diagnostics[0].returnedRows, 0);
  assert.equal(diagnostics[0].error, null);
  assert.equal(diagnostics[1].operation, 'select');
  assert.equal(diagnostics[1].returnedRows, hiddenAfterUpdate ? 0 : 1);
  assert.ok(!JSON.stringify(diagnostics).includes('original_generation_prompt'));
  assert.ok(!failedUpdate.calls.some(call => call.table === 'itinerary_items' && call.operation === 'insert'));
}
console.log('PASS: zero-row insert/update handling, exact new-version filters, and SELECT-visible/hidden diagnostics.');
