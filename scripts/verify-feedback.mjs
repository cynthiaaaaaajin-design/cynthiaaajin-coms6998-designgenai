// Mocked checks only; never reads or writes live Supabase data.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function load(path, dependencies = {}) {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(source, {
    exports: loaded.exports, module: loaded, Response, Request, URL, console,
    require: name => {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
      return dependencies[name];
    },
  });
  return loaded.exports;
}
const helpers = load('../lib/feedback.ts');
const itinerary = load('../lib/itinerary.ts');
const server = load('../lib/feedback-server.ts', { 'server-only': {}, './trip-people': { loadTripPeople: async () => null }, '@/lib/feedback': helpers });
const itemId = '11111111-1111-4111-8111-111111111111';
const otherItem = '22222222-2222-4222-8222-222222222222';
const tripId = '9223372036854775807';
const event = (id, user_id, value, comment = null, item_id = itemId) => ({ id, user_id, value, comment, item_id });
const rows = [
  event('9007199254740992', 'owner', 1, 'Old'),
  event('9007199254740993', 'owner', -1, 'Latest'),
  event('9007199254740994', 'member', 1),
  event('9007199254740995', 'member', 1, 'Still like'),
  event('9007199254740996', 'owner', 1, 'Other activity', otherItem),
];
const summary = helpers.summarizeVotes(rows, 'owner');
assert.equal(summary[itemId].likes, 1);
assert.equal(summary[itemId].dislikes, 1);
assert.equal(summary[itemId].mine.comment, 'Latest');
assert.equal(summary[otherItem].likes, 1);
assert.equal(helpers.parseFeedback({ item_id: itemId, value: 1, comment: '  ', user_id: 'forged' }).comment, null);
assert.equal('user_id' in helpers.parseFeedback({ item_id: itemId, value: 1, user_id: 'forged' }), false);
for (const input of [{ item_id: 'bad', value: 1 }, { item_id: itemId, value: 0 }, { item_id: itemId, value: '1' }, { item_id: itemId, value: 1, comment: 'x'.repeat(2001) }]) {
  assert.throws(() => helpers.parseFeedback(input));
}

function fixture(options = {}) {
  const calls = [];
  const votes = [...(options.rows ?? [])];
  let identity = BigInt('9007199254741000');
  const userId = options.member ? 'member' : 'owner';
  const client = {
    auth: { getUser: async () => ({ data: { user: options.signedOut ? null : { id: userId } } }) },
    from(table) {
      const query = { table, operation: 'select', filters: [] };
      const chain = {
        select(columns) { query.columns = columns; return chain; },
        eq(key, value) { query.filters.push(['eq', key, value]); return chain; },
        in(key, value) { query.filters.push(['in', key, value]); return chain; },
        lt(key, value) { query.filters.push(['lt', key, value]); return chain; },
        order(key, order) { query.order = { key, ...order }; return chain; },
        limit(value) { query.limit = value; return chain; },
        insert(payload) { query.operation = 'insert'; query.payload = payload; return chain; },
        maybeSingle() { return finish(); },
        then(resolve, reject) { return finish().then(resolve, reject); },
      };
      async function finish() {
        calls.push(query);
        if (table === 'trips') return { data: options.hiddenTrip ? null : { user_id: options.outsider ? 'someone-else' : 'owner' } };
        if (table === 'trip_members') return { data: options.member && !options.outsider ? { user_id: userId } : null };
        if (table === 'itinerary_versions') return { data: options.noVersion ? null : { id: 'current-version' } };
        if (table === 'itinerary_items') return { data: options.wrongItem ? null : { id: itemId } };
        assert.equal(table, 'activity_votes');
        if (query.operation === 'insert') {
          if (options.insertDenied) return { error: { code: '42501' } };
          votes.push({ ...query.payload, id: String(identity++) });
          return { error: null };
        }
        if (options.readDenied) return { data: null, error: { code: '42501' } };
        let found = votes.filter(row => query.filters.every(([op, key, value]) =>
          op === 'in' ? value.includes(row[key]) : op === 'lt' ? BigInt(row[key]) < BigInt(value) : row[key] === value));
        found = found.sort((a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : 1);
        // Emulate a project row cap below the requested limit.
        return { data: found.slice(0, 2), error: null };
      }
      return chain;
    },
  };
  const route = load('../app/api/trips/[tripId]/votes/route.ts', {
    '@/lib/supabase/server': { createClient: async () => client },
    '@/lib/itinerary': itinerary,
    '@/lib/feedback': helpers,
    '@/lib/feedback-server': server,
  });
  async function post(input = { item_id: itemId, value: 1, comment: 'Great', user_id: 'forged' }) {
    const response = await route.POST(new Request(`http://localhost/api/trips/${tripId}/votes`, {
      method: 'POST',
      headers: { origin: options.foreignOrigin ? 'https://other.example' : 'http://localhost' },
      body: options.badJson ? '{' : JSON.stringify(input),
    }), { params: Promise.resolve({ tripId }) });
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  return { client, post, calls, votes };
}

const paginated = fixture({ rows });
const paged = await server.loadFeedback(paginated.client, [itemId, otherItem], 'owner');
assert.equal(JSON.stringify(paged[itemId]), JSON.stringify(summary[itemId]));
assert.equal(paginated.calls.length, 4);
assert.equal(paginated.calls[0].columns, 'id::text,item_id,user_id,value,comment');
assert.ok(paginated.calls[1].filters.some(([op, key, value]) => op === 'lt' && key === 'id' && value === '9007199254740995'));
assert.equal(Object.keys(await server.loadFeedback(paginated.client, [], 'owner')).length, 0);

for (const [options, status] of [
  [{ signedOut: true }, 401], [{ hiddenTrip: true }, 404], [{ outsider: true }, 404],
  [{ foreignOrigin: true }, 403], [{ wrongItem: true }, 409], [{ noVersion: true }, 409],
  [{ badJson: true }, 400], [{ insertDenied: true }, 403],
]) {
  const test = fixture(options);
  assert.equal((await test.post()).status, status);
  assert.equal(test.votes.length, 0);
}
const invalid = fixture();
assert.equal((await invalid.post({ item_id: itemId, value: 2 })).status, 400);
assert.equal(invalid.votes.length, 0);

const owner = fixture();
assert.equal((await owner.post()).status, 201);
const changed = await owner.post({ item_id: itemId, value: -1, comment: 'Prefer something else', user_id: 'forged' });
assert.equal(changed.status, 201);
assert.equal(changed.headers.get('cache-control'), 'private, no-store');
assert.equal(owner.votes.length, 2);
assert.equal(owner.votes[0].value, 1);
assert.equal(owner.votes[1].value, -1);
assert.ok(owner.votes.every(row => row.user_id === 'owner'));
assert.equal(changed.body.summary.likes, 0);
assert.equal(changed.body.summary.dislikes, 1);
assert.equal(changed.body.summary.mine.comment, 'Prefer something else');
assert.ok(owner.calls.filter(call => call.table === 'itinerary_items').every(call => call.filters.some(([op, key, value]) => op === 'eq' && key === 'version_id' && value === 'current-version')));
const member = fixture({ member: true, rows: [event('1', 'owner', -1)] });
const memberResult = await member.post();
assert.equal(memberResult.status, 201);
assert.equal(memberResult.body.summary.likes, 1);
assert.equal(memberResult.body.summary.dislikes, 1);
assert.equal(member.votes.at(-1).user_id, 'member');
assert.ok(member.calls.some(call => call.table === 'trip_members'));
const readFailure = fixture({ readDenied: true });
const readFailureResult = await readFailure.post();
assert.equal(readFailureResult.status, 201);
assert.equal(readFailureResult.body.summary, null);
assert.equal(readFailureResult.body.saved.value, 1);
assert.match(readFailureResult.body.warning, /saved/);
assert.equal(readFailure.votes.length, 1);
console.log('PASS: append-only inserts, owner/member authorization, forged user IDs, current-item validation, latest-vote counts, bigint ordering, pagination, and save/read failures.');

assert.equal(summary[itemId].group.length, 2);
assert.ok(summary[itemId].group.some(vote => vote.comment === 'Latest'));
assert.equal(new Set(summary[itemId].group.map(vote => vote.userId)).size, 2);
console.log('PASS: group summary includes each traveler’s latest vote/comment.');
const namedServer = load('../lib/feedback-server.ts', {
  'server-only': {}, '@/lib/feedback': helpers,
  './trip-people': {
    loadTripPeople: async () => [{ user_id: 'owner', first_name: 'Cynthia', last_name: 'Jin' }, { user_id: 'member', first_name: 'Yuxin', last_name: 'Jin' }],
    personName: person => `${person.first_name} ${person.last_name}`,
  },
});
// Reuse the paginated fixture: names enrich the same group rows, never a user-only query.
const named = await namedServer.loadFeedback(paginated.client, [itemId], 'owner', '3');
assert.ok(named[itemId].group.some(vote => vote.name === 'Yuxin Jin'));
assert.ok(named[itemId].group.some(vote => vote.name === 'Cynthia Jin'));
