// Local mocks only; no live Supabase/profile reads, memberships, or emails.
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
const travelerHelpers = load('../lib/travelers.ts');
const itinerary = load('../lib/itinerary.ts');
const server = load('../lib/travelers-server.ts', { 'server-only': {}, './trip-people': { loadTripPeople: async () => null } });
const ownerId = '11111111-1111-4111-8111-111111111111';
const travelerId = '22222222-2222-4222-8222-222222222222';
assert.equal(travelerHelpers.travelerEmail({ email: ' Friend@Example.com ' }), 'friend@example.com');
for (const input of [{ email: '' }, { email: 'friend' }, { email: 'a@b' }, { email: 'x'.repeat(255) }, null]) {
  assert.throws(() => travelerHelpers.travelerEmail(input));
}
assert.throws(() => travelerHelpers.travelerId({ user_id: 'not-a-uuid' }));

function fixture(options = {}) {
  const calls = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: options.signedOut ? null : { id: ownerId } } }) },
    async rpc(name, payload) {
      calls.push({ operation: 'rpc', name, payload });
      return { data: options.rpcResult ?? 'success', error: options.rpcError ? { code: options.rpcError } : null };
    },
    from(table) {
      const query = { table, operation: 'select', filters: [] };
      const chain = {
        select(columns) { query.columns = columns; return chain; },
        eq(key, value) { query.filters.push(['eq', key, value]); return chain; },
        gt(key, value) { query.filters.push(['gt', key, value]); return chain; },
        order(key) { query.order = key; return chain; }, limit(value) { query.limit = value; return chain; },
        insert(payload) { query.operation = 'insert'; query.payload = payload; return chain; },
        delete() { query.operation = 'delete'; return chain; },
        maybeSingle() { return finish(); },
        then(resolve, reject) { return finish().then(resolve, reject); },
      };
      async function finish() {
        calls.push(query);
        if (table === 'trips') return { data: options.notOwner ? null : { user_id: ownerId } };
        if (table === 'profiles') return { data: options.hiddenProfile ? [] : [{ id: options.self ? ownerId : travelerId, email: 'friend@example.com', first_name: 'Friend', last_name: 'Traveler' }], error: options.lookupError ? { code: '42501' } : null };
        assert.equal(table, 'trip_members');
        if (query.operation === 'insert') return { error: options.insertError ? { code: options.insertError } : null };
        if (query.operation === 'delete') return { data: options.noRemoval ? [] : [{ user_id: travelerId }], error: options.deleteError ? { code: '42501' } : null };
        return { data: query.filters.some(([op]) => op === 'gt') ? [] : [{ user_id: travelerId, profile: options.hiddenLabel ? null : { email: 'friend@example.com', first_name: 'Friend', last_name: 'Traveler' } }] };
      }
      return chain;
    },
  };
  const route = load('../app/api/trips/[tripId]/members/route.ts', {
    '@/lib/supabase/server': { createClient: async () => client },
    '@/lib/itinerary': itinerary,
    '@/lib/travelers': travelerHelpers,
    '@/lib/travelers-server': server,
  });
  async function run(method = 'POST', payload = { email: 'friend@example.com', user_id: 'forged', trip_id: 99 }) {
    const response = await route[method](new Request('http://localhost/api/trips/3/members', {
      method, headers: { origin: options.foreignOrigin ? 'https://other.example' : 'http://localhost' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(payload) }),
    }), { params: Promise.resolve({ tripId: '3' }) });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  return { client, calls, run };
}
for (const method of ['GET', 'POST', 'DELETE']) {
  for (const [options, status] of [[{ signedOut: true }, 401], [{ notOwner: true }, 404]]) {
    const test = fixture(options);
    assert.equal((await test.run(method)).status, status);
    assert.ok(!test.calls.some(call => call.table === 'profiles' || call.table === 'trip_members' || call.operation === 'rpc'));
  }
}
const success = fixture();
const result = await success.run();
assert.equal(result.status, 201);
assert.equal(result.headers.get('cache-control'), 'private, no-store');
assert.ok(success.calls[0].filters.some(([, key, value]) => key === 'user_id' && value === ownerId));
const rpc = success.calls.find(call => call.operation === 'rpc');
assert.equal(rpc.name, 'add_trip_member_by_email');
assert.equal(rpc.payload.p_trip_id, '3');
assert.equal(rpc.payload.p_email, 'friend@example.com');
assert.equal(Object.keys(rpc.payload).length, 2);
assert.equal(result.body.message, 'Traveler added.');
assert.equal('traveler' in result.body, false);
assert.ok(!success.calls.some(call => call.table === 'profiles' || call.operation === 'insert'));
for (const [rpcResult, status, message] of [
  ['invalid_email', 400, 'Enter a valid email address.'],
  ['user_not_found', 404, 'No TripSync account was found for this email. Ask them to sign in first.'],
  ['cannot_add_owner', 400, 'You are already the owner of this trip.'],
  ['already_member', 200, 'This traveler already has access.'],
]) {
  const response = await fixture({ rpcResult }).run();
  assert.equal(response.status, status);
  assert.equal(response.body.error ?? response.body.message, message);
}
assert.equal((await fixture({ rpcResult: 'unexpected' }).run()).status, 500);
assert.equal((await fixture({ rpcError: '42501' }).run()).status, 403);
assert.equal((await fixture({ rpcError: 'XX000' }).run()).status, 500);
const foreign = fixture({ foreignOrigin: true });
assert.equal((await foreign.run()).status, 403);
assert.ok(!foreign.calls.some(call => call.operation === 'rpc'));
const invalid = fixture();
assert.equal((await invalid.run('POST', { email: 'bad' })).status, 400);
assert.ok(!invalid.calls.some(call => call.operation === 'rpc'));
assert.equal((await fixture().run('GET')).body.travelers[0].email, null);
const removal = fixture();
assert.equal((await removal.run('DELETE', { user_id: travelerId })).status, 200);
const deleteQuery = removal.calls.find(call => call.operation === 'delete');
assert.ok(deleteQuery.filters.some(([, key, value]) => key === 'trip_id' && value === '3'));
assert.ok(deleteQuery.filters.some(([, key, value]) => key === 'user_id' && value === travelerId));
assert.equal((await fixture().run('DELETE', { user_id: ownerId })).status, 400);
assert.equal((await fixture({ noRemoval: true }).run('DELETE', { user_id: travelerId })).status, 409);
assert.equal((await fixture({ deleteError: true }).run('DELETE', { user_id: travelerId })).status, 403);
const members = await fixture({ hiddenLabel: true }).run('GET');
assert.equal(members.status, 200);
assert.equal(members.body.travelers[0].userId, travelerId);
assert.equal(members.body.travelers[0].email, null);

// Even an unexpectedly broad trips SELECT cannot expose nonparticipant cards.
const listClient = {
  from(table) {
    let after = false;
    const chain = {
      select() { return chain; }, eq() { return chain; }, order() { return chain; }, limit() { return chain; },
      gt() { after = true; return chain; },
      then(resolve, reject) {
        const data = after ? [] : table === 'trip_members' ? [{ trip_id: '2' }] : [
          { id: '1', user_id: ownerId, title: 'Owned', start_date: '2026-10-10' },
          { id: '2', user_id: travelerId, title: 'Shared', start_date: '2026-10-11' },
          { id: '3', user_id: travelerId, title: 'Private outsider trip', start_date: '2026-10-12' },
        ];
        return Promise.resolve({ data }).then(resolve, reject);
      },
    };
    return chain;
  },
};
const visible = await server.loadPrivateTrips(listClient, ownerId);
assert.equal(visible.length, 2);
assert.equal(visible[0].title, 'Owned');
assert.equal(visible[1].title, 'Shared');
console.log('PASS: owner-only management, exact-email RPC/status mapping, no profile/email exposure, RPC failures, scoped removal, hidden profile labels, and private dashboard filtering.');

assert.equal(visible[0].isOwner, true);
assert.equal(visible[1].isOwner, false);
assert.equal(visible[1].ownerName, null);
