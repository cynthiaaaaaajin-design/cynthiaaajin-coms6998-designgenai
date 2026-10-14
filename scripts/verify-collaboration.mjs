// Route and validation tests with a stateful fake adapter; not proof of live RLS.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(path, deps = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, Request, Response, URL, console, require: n => { if (!(n in deps)) throw new Error(`Unexpected dependency ${n}`); return deps[n]; } });
  return loaded.exports;
}
const helpers = load('../lib/collaboration.ts');
const itinerary = load('../lib/itinerary.ts');
const owner = '11111111-1111-4111-8111-111111111111';
const member = '22222222-2222-4222-8222-222222222222';
const item = '33333333-3333-4333-8333-333333333333';
const version = '44444444-4444-4444-8444-444444444444';
const id = '55555555-5555-4555-8555-555555555555';
const prefs = { budget_amount: null, budget_currency: 'USD', budget_scope: 'per_person_total', budget_notes: null, travel_pace: 'balanced', must_visit_places: ['Museum'], interests: [], hard_constraints: ['No stairs'], additional_notes: null };
for (const bad of [{ budget_amount: -1 }, { budget_amount: NaN }, { budget_scope: 'total' }, { budget_currency: 'usd' }, { interests: ['x'.repeat(301)] }, { interests: Array(31).fill('art') }, { hard_constraints: [null] }, { additional_notes: 'x'.repeat(2001) }]) assert.throws(() => helpers.parseTravelPreferences({ ...prefs, ...bad }));
assert.equal(helpers.parseTravelPreferences({ ...prefs, user_id: owner }).user_id, undefined);
assert.throws(() => helpers.parseChangeRequest({ item_id: item, version_id: version, request_type: 'replacement' }));
assert.throws(() => helpers.parseChangeRequest({ item_id: item, version_id: version, request_type: 'toString' }));
const state = { user: owner, current: version, preferences: [], requests: [], calls: [], access: true, wrongItem: false };
const client = {
  auth: { getUser: async () => ({ data: { user: state.user ? { id: state.user } : null } }) },
  rpc: () => ({ range: async (offset) => ({ data: offset ? [] : [{ user_id: owner, name: 'Owner' }, { user_id: member, name: 'Member' }] }) }),
  from(table) {
    let op = 'select', payload; const filters = [];
    const query = { select: () => query, eq: (k,v) => { filters.push([k,v]); return query; }, order: () => query, limit: () => query,
      gt: (k,v) => { filters.push(['cursor', v]); return query; },
      upsert: p => { op = 'upsert'; payload = p; return query; }, insert: p => { op = 'insert'; payload = p; return query; }, update: p => { op = 'update'; payload = p; return query; },
      single: () => finish(true), maybeSingle: () => finish(true), then: (r,j) => finish(false).then(r,j) };
    async function finish(single) {
      state.calls.push({ table, op, payload, filters });
      if (table === 'trips') return { data: state.access ? { user_id: owner } : null };
      if (table === 'trip_members') return { data: state.user === member ? { user_id: member } : null };
      if (table === 'itinerary_versions') return { data: { id: state.current } };
      if (table === 'itinerary_items') return { data: state.wrongItem ? null : { id: item } };
      const rows = table === 'trip_preferences' ? state.preferences : state.requests;
      if (op === 'upsert') {
        const index = rows.findIndex(r => r.user_id === payload.user_id);
        if (index < 0) rows.push(payload); else rows[index] = payload;
        return { data: { user_id: payload.user_id } };
      }
      if (op === 'insert') { rows.push({ ...payload, id, status: 'pending' }); return { data: { id } }; }
      const found = rows.filter(r => filters.every(([k,v]) => k === 'cursor' ? r.id > v : r[k] === v));
      if (op === 'update') found.forEach(r => Object.assign(r,payload));
      return { data: single ? found[0] ?? null : found };
    }
    return query;
  },
};
const feedbackServer = load('../lib/feedback-server.ts', { 'server-only': {}, './trip-people': {}, '@/lib/feedback': {} });
const common = load('../lib/collaboration-route.ts', { '@/lib/supabase/server': { createClient: async () => client }, '@/lib/feedback-server': feedbackServer, '@/lib/itinerary': itinerary });
const server = load('../lib/collaboration-server.ts', { 'server-only': {} });
const deps = { '@/lib/collaboration-route': common, '@/lib/collaboration': helpers, '@/lib/collaboration-server': server };
const preferences = load('../app/api/trips/[tripId]/preferences/route.ts', deps);
const suggestions = load('../app/api/trips/[tripId]/suggestions/route.ts', deps);
async function call(route, method, body, suffix = '', headers = {}) {
  return route[method](new Request(`http://localhost/api/trips/1/test${suffix}`, { method, headers, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) }), { params: Promise.resolve({ tripId: '1' }) });
}
assert.equal((await call(preferences, 'PUT', prefs)).status, 200);
state.user = member;
assert.equal((await call(preferences, 'PUT', { ...prefs, user_id: owner })).status, 200);
assert.equal(state.preferences.length, 2);
assert.equal(state.preferences[1].user_id, member, 'Cannot select another author');
assert.equal((await call(preferences, 'PUT', { ...prefs, travel_pace: 'relaxed' })).status, 200);
// This route GET runs the real paginated loader against stored rows.
const read = await call(preferences, 'GET');
assert.equal(read.status, 200);
assert.equal((await read.json()).preferences.find(p => p.user_id === member).travel_pace, 'relaxed');
for (const user of [null, 'outsider']) {
  state.user = user;
  for (const [route, method, data] of [[preferences,'GET'],[preferences,'PUT',prefs],[suggestions,'POST',{}],[suggestions,'PATCH',{}]]) {
    assert.equal((await call(route,method,data)).status, user ? 404 : 401);
  }
}
state.user = member;
assert.equal((await call(preferences,'PUT',prefs,'',{ origin: 'https://evil.example' })).status,403);
const suggestion = { item_id: item, version_id: version, request_type: 'too_expensive', comment: 'Choose a cheaper museum', created_by: owner };
assert.equal((await call(suggestions,'POST',suggestion)).status,201);
assert.equal(state.requests[0].created_by,member);
assert.ok(!state.calls.some(c => c.table === 'activity_votes'), 'Suggestions never insert duplicate votes');
assert.equal((await call(suggestions,'PATCH',{ id,status:'resolved' })).status,403);
state.user = owner;
assert.equal((await call(suggestions,'PATCH',{ id,status:'resolved' })).status,200);
assert.equal(state.requests[0].status,'resolved');
assert.equal((await call(suggestions,'PATCH',{ id,status:'declined' })).status,409);
state.requests[0].status='pending';
assert.equal((await call(suggestions,'PATCH',{ id,status:'declined' })).status,200);
state.current = owner;
assert.equal((await call(suggestions,'POST',suggestion)).status,409);
assert.equal(state.requests[0].version_id,version);
assert.equal(state.requests[0].status,'declined');
assert.equal((await (await call(suggestions,'GET',null,`?version=${version}`)).json()).requests.length,1);
state.current=version; state.wrongItem=true;
assert.equal((await call(suggestions,'POST',suggestion)).status,409);
console.log('PASS: collaboration validation, owner/member persistence and updates, identity whitelist, outsider/signed-out/origin denial, associations, owner resolution/decline, historical preservation, and no duplicate votes. Mocked database only.');
