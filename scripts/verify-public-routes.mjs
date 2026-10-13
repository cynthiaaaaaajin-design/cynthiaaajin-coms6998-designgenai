import assert from "node:assert/strict";

// Run against an already-started dev or production server. No session or writes.
const origin = new URL(process.argv[2] ?? "http://localhost:3000").origin;
async function get(path) {
  return fetch(new URL(path, origin), { redirect: "manual" });
}
const home = await get("/");
assert.equal(home.status, 200);
const html = await home.text();
assert.match(html, /TripSync/);
assert.match(html, /Continue with Google/);
console.log("PASS homepage renders TripSync and Google login");

for (const path of ["/profile", "/trips"]) {
  const response = await get(path);
  assert.equal(response.status, 307, `${path} should redirect`);
  assert.equal(new URL(response.headers.get("location"), origin).pathname, "/");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  console.log(
    `PASS ${path} redirects signed-out requests home without caching`,
  );
}
for (const path of ["/auth/callback", "/auth/callback?error=access_denied"]) {
  const response = await get(path);
  assert.equal(response.status, 307);
  const target = new URL(response.headers.get("location"), origin);
  assert.equal(target.pathname, "/");
  assert.equal(target.searchParams.get("auth_error"), "1");
  assert.match(response.headers.get("cache-control") ?? "", /no-store/);
  console.log(
    `PASS ${path} redirects to the sign-in error state without caching`,
  );
}
const errorPage = await get("/?auth_error=1");
assert.equal(errorPage.status, 200);
assert.match(await errorPage.text(), /Google sign-in didn’t finish/);
console.log("PASS OAuth failure displays a retry message");
const shared = await get('/trips/123');
assert.ok([200, 307].includes(shared.status));
// A loading boundary may stream a Next.js meta redirect after sending HTTP 200.
const sharedHtml = await shared.text();
const streamedLocation = sharedHtml.match(/<meta id="__next-page-redirect"[^>]*content="[^;]+;url=([^"]+)"/)?.[1];
const loginLocation = shared.headers.get('location') ?? streamedLocation;
assert.ok(loginLocation, 'Expected an HTTP or streamed login redirect');
const login = new URL(loginLocation, origin);
assert.equal(login.pathname, '/');
assert.equal(login.searchParams.get('next'), '/trips/123');
const retry = await get('/auth/callback?error=access_denied&next=%2Ftrips%2F123');
assert.equal(new URL(retry.headers.get('location'), origin).searchParams.get('next'), '/trips/123');
console.log('PASS signed-out shared-trip destination survives login redirect and OAuth cancellation');
