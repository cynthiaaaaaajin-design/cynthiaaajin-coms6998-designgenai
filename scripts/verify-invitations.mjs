// No live accounts or memberships are changed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as crypto from 'node:crypto';
function load(path, deps = {}) {
  const loaded = { exports: {} };
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, Response, Request, URL, require: name => { assert.ok(name in deps, name); return deps[name]; } });
  return loaded.exports;
}
const helpers = load('lib/invitations.ts');
const itinerary = load('lib/itinerary.ts');
const destination = load('lib/auth-destination.ts');
const token = 'a'.repeat(64);
assert.equal(destination.tripDestination(`/invite/${token}`), `/invite/${token}`);
for (const input of ['a'.repeat(63), 'G'.repeat(64), '', null, {}, 'a'.repeat(65)]) assert.equal(helpers.validInviteToken(input), false);
for (const input of [`/invite/${token}?next=https://evil.test`, `/invite/${token}/..`, `//evil.test/invite/${token}`]) assert.equal(destination.tripDestination(input), null);
let user = { id: 'owner' }, rpcResult, rpcError, calls = [];
const client = { auth: { getUser: async () => ({ data: { user } }) }, rpc: async (name, args) => { calls.push({ name, args }); return { data: rpcResult, error: rpcError }; } };
const deps = { '@/lib/invitations': helpers, '@/lib/itinerary': itinerary, '@/lib/supabase/server': { createClient: async () => client }, 'node:crypto': crypto };
const manage = load('app/api/trips/[tripId]/invitation/route.ts', deps);
const accept = load('app/api/invitations/accept/route.ts', deps);
function request(body = { token }, origin = 'https://trips.test', method = 'POST') { return new Request('https://trips.test/api/invitations/accept', { method, headers: { origin, 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) }); }
const context = { params: Promise.resolve({ tripId: '10' }) };
assert.equal((await manage.POST(request({}, 'https://evil.test'), context)).status, 403);
assert.equal((await accept.POST(request({ token }, 'https://evil.test'))).status, 403);
assert.equal(calls.length, 0);
user = null;
assert.equal((await accept.POST(request())).status, 401);
assert.equal((await manage.POST(request(), context)).status, 401);
assert.equal(calls.length, 0);
user = { id: 'owner' }; rpcError = { code: '42501' };
assert.equal((await manage.POST(request(), context)).status, 403);
rpcError = null; rpcResult = '2026-10-20T00:00:00Z';
const response = await manage.POST(request(), context); const invitation = await response.json();
assert.match(invitation.path, /^\/invite\/[0-9a-f]{64}$/);
assert.match(response.headers.get('cache-control'), /no-store/);
const last = calls.at(-1);
assert.equal(last.name, 'manage_trip_invitation'); assert.equal(last.args.p_trip_id, '10');
assert.equal(last.args.p_hash, crypto.createHash('sha256').update(invitation.path.split('/').at(-1)).digest('hex'));
assert.notEqual(last.args.p_hash, invitation.path.split('/').at(-1));
await manage.DELETE(request({}, 'https://trips.test', 'DELETE'), context);
assert.equal(calls.at(-1).args.p_hash, null);
for (const result of ['joined', 'already_member']) {
 rpcResult = { result, tripId: '10' };
 assert.equal((await (await accept.POST(request())).json()).path, '/trips/10');
 assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1).args)), { p_token: token });
}
for (const [result, status] of [['invalid',410],['unverified',403],['profile_missing',409]]) {
 rpcResult = { result }; assert.equal((await accept.POST(request())).status, status);
}
const before = calls.length;
assert.equal((await accept.POST(request({ token: 'bad', user_id: 'forged' }))).status, 400);
assert.equal(calls.length, before);
rpcError = { code: 'PGRST202' };
assert.equal((await accept.POST(request())).status, 503);
console.log('PASS: invitation token validation, internal redirects, CSRF, login requirement, owner RPC errors, hash-only persistence, revocation, join/repeat-join, invalid/expired response and missing migration fallback. Database authorization still requires live SQL verification.');
