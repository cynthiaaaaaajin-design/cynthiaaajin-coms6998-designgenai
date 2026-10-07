import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(path, dependencies = {}) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const loaded = { exports: {} };
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, Response, Request, URL, require: name => {
    assert.ok(name in dependencies, name); return dependencies[name];
  } });
  return loaded.exports;
}
const validation = load('../lib/create-trip.ts');
const itinerary = load('../lib/itinerary.ts');
const valid = { title: '  First adventure  ', destination: 'Paris', start_date: '2026-12-01', end_date: '2026-12-04' };
assert.equal(validation.parseNewTrip(valid).title, 'First adventure');
for (const key of Object.keys(valid)) assert.throws(() => validation.parseNewTrip({ ...valid, [key]: '' }));
for (const patch of [{ title: ' ' }, { destination: ' ' }, { end_date: '2026-11-30' }, { start_date: '2026-02-30' }, { start_date: 'not-a-date' }, { title: 'x'.repeat(201) }]) {
  assert.throws(() => validation.parseNewTrip({ ...valid, ...patch }));
}
assert.doesNotThrow(() => validation.parseNewTrip({ ...valid, end_date: valid.start_date }));
async function scenario(options = {}) {
  const writes = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: options.signedOut ? null : { id: 'verified-owner' } }, error: options.authError ? {} : null }) },
    from(table) {
      assert.equal(table, 'trips');
      return { insert(payload) { writes.push(payload); return { select(columns) {
        assert.equal(columns, 'id::text');
        return { maybeSingle: async () => ({ data: options.noRow ? null : { id: '9223372036854775807' }, error: options.denied ? { code: '42501' } : null }) };
      } }; } };
    },
  };
  const route = load('../app/api/trips/route.ts', { '@/lib/create-trip': validation, '@/lib/itinerary': itinerary, '@/lib/supabase/server': { createClient: async () => client } });
  const response = await route.POST(new Request('http://localhost/api/trips', { method: 'POST', headers: { origin: options.foreign ? 'https://outsider.test' : 'http://localhost' }, body: options.raw ?? JSON.stringify(options.input ?? { ...valid, user_id: 'forged', is_public: true, id: 99 }) }));
  return { status: response.status, body: await response.json(), writes };
}
const success = await scenario();
assert.equal(success.status, 201);
assert.equal(success.body.tripId, '9223372036854775807');
assert.equal(success.writes[0].user_id, 'verified-owner');
assert.equal(Object.keys(success.writes[0]).length, 5);
assert.equal('is_public' in success.writes[0], false);
for (const [options, status] of [[{ signedOut: true }, 401], [{ authError: true }, 401], [{ foreign: true }, 403], [{ raw: '{' }, 400], [{ input: { ...valid, end_date: '2026-01-01' } }, 400]]) {
  const result = await scenario(options); assert.equal(result.status, status); assert.equal(result.writes.length, 0);
}
for (const options of [{ denied: true }, { noRow: true }]) assert.equal((await scenario(options)).status, 500);
console.log('PASS: required/real/ordered dates, same-day trips, verified ownership, field whitelist/privacy, bigint return ID, unauthenticated/cross-origin rejection, and failed saves.');
