import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function load(path, deps = {}) {
  const loaded = { exports: {} };
  const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(code, { module: loaded, exports: loaded.exports, URL, Response, Request, require: name => { assert.ok(name in deps, name); return deps[name]; } });
  return loaded.exports;
}
const destination = load('lib/auth-destination.ts');
for (const input of ['https://evil.test', '//evil.test', '/\\evil.test', '/trips/1/../../profile', '/trips/1?next=https://evil.test', [' /trips'], null]) assert.equal(destination.tripDestination(input), null);
for (const input of ['/trips', '/trips/123', '/trips/9223372036854775807']) assert.equal(destination.tripDestination(input), input);
async function check({ profile = { first_name: 'Returning', last_name: 'Traveler' }, next = '', cookie = '', exchangeError = false, signedOut = false, profileError = false, code = 'test' } = {}) {
  const client = {
    auth: { exchangeCodeForSession: async () => ({ error: exchangeError }), getUser: async () => ({ data: { user: signedOut ? null : { id: 'user' } } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile, error: profileError }) }) }) }),
  };
  const route = load('app/auth/callback/route.ts', {
    '@/lib/auth-destination': destination,
    '@/lib/supabase/server': { createClient: async () => client },
    'next/server': { NextResponse: { redirect: url => new Response(null, { status: 307, headers: { location: String(url) } }) } },
  });
  const response = await route.GET(new Request(`https://trips.test/auth/callback?code=${code}&next=${encodeURIComponent(next)}`,{headers:{cookie}}));
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.match(response.headers.get('set-cookie'),/tripsync-auth-next=;.*HttpOnly;.*Max-Age=0/);
  return new URL(response.headers.get('location'));
}
assert.equal((await check()).pathname, '/trips');
for (const profile of [null, { first_name: ' ', last_name: 'New' }, { first_name: 'New', last_name: null }]) assert.equal((await check({ profile })).pathname, '/profile');
assert.equal((await check({ profileError: true })).pathname, '/profile');
assert.equal((await check({ next: '/trips/123' })).pathname, '/trips/123');
assert.equal((await check({ next: '/trips/123', profile: null })).pathname, '/trips/123');
assert.equal((await check({ next: '//evil.test' })).pathname, '/trips');
for (const options of [{ exchangeError: true }, { signedOut: true }, { code: '' }]) {
  const url = await check({ ...options, next: '/trips/123' });
  assert.equal(url.pathname, '/'); assert.equal(url.searchParams.get('next'), '/trips/123'); assert.equal(url.searchParams.get('auth_error'), '1');
}
console.log('PASS: returning/new/incomplete profiles, intended shared-trip destinations, retry preservation, no-store responses, and external-redirect rejection. OAuth/session calls mocked.');

const invitePath = '/invite/' + 'a'.repeat(64);
assert.equal((await check({ next: invitePath, profile: null })).pathname, invitePath);
assert.equal((await check({ next: invitePath, exchangeError: true })).searchParams.get('next'), invitePath);
console.log('PASS: invitation destination preserved for new-user OAuth and failed-login retry.');

const communityPath='/community/12345678-1234-4234-8234-123456789abc';
assert.equal((await check({next:communityPath,profile:null})).pathname,communityPath);
assert.equal((await check({next:communityPath,exchangeError:true})).searchParams.get('next'),communityPath);
for(const input of ['/community//evil.test','/community?next=https://evil.test','/community/../profile','/community/invalid']) assert.equal(destination.tripDestination(input),null);
console.log('PASS: community rating destination preserved across OAuth; malformed community redirects rejected.');

for(const path of ['/trips/21',invitePath,communityPath])assert.equal((await check({cookie:`tripsync-auth-next=${encodeURIComponent(path)}`})).pathname,path);
for(const value of ['%E0%A4%A','https%3A%2F%2Fevil.test','%2F%2Fevil.test'])assert.equal((await check({cookie:`tripsync-auth-next=${value}`})).pathname,'/trips');
assert.equal((await check({cookie:'tripsync-auth-next=%2Ftrips%2F21',exchangeError:true})).searchParams.get('next'),'/trips/21');
const destinationRoute=load('app/api/auth/destination/route.ts',{'@/lib/auth-destination':destination});
async function remember(next,origin='https://trips.test') {return destinationRoute.POST(new Request('https://trips.test/api/auth/destination',{method:'POST',headers:{origin},body:JSON.stringify({next})}));}
let remembered=await remember('/trips/21');assert.equal(remembered.status,200);assert.match(remembered.headers.get('set-cookie'),/tripsync-auth-next=%2Ftrips%2F21;.*HttpOnly;.*SameSite=Lax;.*Max-Age=600; Secure/);
assert.equal((await remember('/trips/21','https://evil.test')).status,403);
for(const invalid of ['https://evil.test','/trips/21?x=1','/invite/invalid',{},undefined])assert.equal((await remember(invalid)).status,400);
assert.match((await remember(null)).headers.get('set-cookie'),/Max-Age=0/);
console.log('PASS exact OAuth callback support: bounded same-origin HttpOnly return cookie, safe trip/invitation/community destinations, expiry, consumption, malformed/external rejection and retry preservation. OAuth calls remain mocked.');
