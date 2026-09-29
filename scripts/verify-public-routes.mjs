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
