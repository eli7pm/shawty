// Offline unit tests for Shawty's triggers (pagelove/system/triggers.html).
// Platform behaviour (authz rules, real sessions, caching) is covered by features/.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { parseHTML } from "linkedom";
import { loadSite } from "../support/harness.mjs";

const ROOT = process.env.PAGELOVE_ROOT ?? fileURLToPath(new URL("../../pagelove/", import.meta.url));
const HOST = "grin-veil-8450.onpagelove.com";
const TYPE = `https://${HOST}/schema/ShortLink`;
const alice = { sub: "google-sub-alice", name: "Alice", email: "alice@example.test" };
const bob = { sub: "google-sub-bob", name: "Bob" };

let site;
beforeEach(async () => {
  site = await loadSite(ROOT, { host: HOST }); // fresh, empty data per test
});

const create = (auth, body) => site.request({ method: "POST", path: "/api/links", body, auth });
const list = (auth) => site.request({ method: "GET", path: "/api/links", auth });
const del = (auth, code) => site.request({ method: "DELETE", path: `/api/links?code=${encodeURIComponent(code)}`, auth });
const open = (code) => site.request({ method: "GET", path: `/s/${code}` });

// --- /api/me -----------------------------------------------------------------

test("/api/me reports signed-out visitors", async () => {
  const res = await site.request({ path: "/api/me" });
  assert.equal(res.status, 200);
  assert.deepEqual(res.json, { signedIn: false });
});

test("/api/me returns the user's profile but never the subject id", async () => {
  const res = await site.request({ path: "/api/me", auth: alice });
  assert.equal(res.json.signedIn, true);
  assert.equal(res.json.user.name, "Alice");
  assert.ok(!JSON.stringify(res.json).includes(alice.sub));
});

test("identity falls back to claims.sub", async () => {
  const res = await site.request({ path: "/api/me", auth: { claims: { sub: "x", name: "Claimy" } } });
  assert.equal(res.json.user.name, "Claimy");
});

test("/api/me rejects other methods", async () => {
  assert.equal((await site.request({ method: "POST", path: "/api/me", auth: alice })).status, 405);
});

// --- auth gate -----------------------------------------------------------------

for (const method of ["GET", "POST", "DELETE"]) {
  test(`${method} /api/links without a session is 401`, async () => {
    const res = await site.request({ method, path: "/api/links?code=abc", body: { url: "https://a.test" } });
    assert.equal(res.status, 401);
    assert.equal(res.json.error, "Please sign in first.");
  });
}

test("private responses are never cached", async () => {
  const res = await list(alice);
  assert.equal(res.headers["Cache-Control"], "private, no-store");
});

// --- create ------------------------------------------------------------------------

test("creates a link with a random 6+ char code and stores it in the data page", async () => {
  const res = await create(alice, { url: "https://example.com/page" });
  assert.equal(res.status, 201);
  assert.match(res.json.link.code, /^[a-km-zA-HJ-NP-Z2-9]{6,}$/);
  assert.equal(res.json.link.url, "https://example.com/page");
  assert.ok(!("owner" in res.json.link), "owner must not be exposed");
  const stored = site.items(TYPE);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].owner, alice.sub);
  assert.match(site.doc("/data/links.html"), new RegExp(`id="l-${res.json.link.code}"`));
});

test("accepts a custom code", async () => {
  const res = await create(alice, { url: "https://example.com", code: "promo_2026" });
  assert.equal(res.status, 201);
  assert.equal(res.json.link.code, "promo_2026");
});

test("a taken custom code is 409, even for another user", async () => {
  await create(alice, { url: "https://a.test", code: "promo" });
  const res = await create(bob, { url: "https://b.test", code: "promo" });
  assert.equal(res.status, 409);
  assert.equal(site.items(TYPE).length, 1);
});

test("storage-level uniqueness rejects a duplicate that slips past the pre-check", () => {
  site.post(
    `<li id="l-dup" itemscope itemtype="${TYPE}"><meta itemprop="code" content="dup"><meta itemprop="url" content="https://a.test"><meta itemprop="owner" content="a"><meta itemprop="created" content="1"></li>`,
    "/data/links.html", "#links", "prepend"
  );
  assert.throws(
    () => site.post(
      `<li id="l-dup2" itemscope itemtype="${TYPE}"><meta itemprop="code" content="dup"><meta itemprop="url" content="https://b.test"><meta itemprop="owner" content="b"><meta itemprop="created" content="2"></li>`,
      "/data/links.html", "#links", "prepend"
    ),
    /unique/
  );
  assert.equal(site.items(TYPE).length, 1, "rejected write is rolled back");
});

for (const code of ["ab", "has space", "x".repeat(33), "semi;colon", 'quo"te', "#hash"]) {
  test(`rejects invalid custom code ${JSON.stringify(code)}`, async () => {
    assert.equal((await create(alice, { url: "https://a.test", code })).status, 400);
  });
}

for (const url of [
  "", "not a url", "javascript:alert(1)", "data:text/html,hi", "ftp://files.test/x",
  "https://", "https://exa mple.com", `https://${HOST}/s/abc123`,
]) {
  test(`rejects URL ${JSON.stringify(url)}`, async () => {
    const res = await create(alice, { url });
    assert.equal(res.status, 400);
    assert.match(res.json.error, /valid http\(s\) URL/);
  });
}

test("accepts a ~6 KB URL (real app-state links) and rejects > 32,768 chars", async () => {
  const long = "https://www.example.com/demo?p=" + "a".repeat(5900);
  assert.equal((await create(alice, { url: long })).status, 201);
  const tooLong = "https://example.com/?" + "a".repeat(32768);
  assert.equal((await create(alice, { url: tooLong })).status, 400);
});

test("own-host links outside /s/ are allowed", async () => {
  assert.equal((await create(alice, { url: `https://${HOST}/` })).status, 201);
});

test("accepts a JSON string body and a form-encoded body", async () => {
  const json = await site.request({ method: "POST", path: "/api/links", auth: alice, rawBody: JSON.stringify({ url: "https://j.test" }) });
  assert.equal(json.status, 201);
  const form = await site.request({ method: "POST", path: "/api/links", auth: alice, rawBody: "url=https%3A%2F%2Ff.test%2F%3Fa%3D1&code=formy" });
  assert.equal(form.status, 201);
  assert.equal(form.json.link.url, "https://f.test/?a=1");
});

test("attribute-breaking characters in URLs are escaped in storage", async () => {
  const url = 'https://x.test/?q="><script>alert(1)</script>';
  const res = await create(alice, { url });
  assert.equal(res.status, 201);
  // Serializers leave "<" literal inside attribute values; what matters is that no element escaped.
  const { document } = parseHTML(site.doc("/data/links.html"));
  assert.equal(document.querySelectorAll("script").length, 0);
  assert.equal(document.querySelectorAll("#links > li").length, 1);
  assert.equal(site.items(TYPE)[0].url, url, "round-trips exactly");
});

// --- list / isolation ---------------------------------------------------------------

test("each user lists only their own links, newest first", async () => {
  await create(alice, { url: "https://a1.test", code: "alice-1" });
  await create(bob, { url: "https://b1.test", code: "bob-1" });
  await new Promise((r) => setTimeout(r, 5));
  await create(alice, { url: "https://a2.test", code: "alice-2" });
  const a = await list(alice);
  assert.deepEqual(a.json.links.map((l) => l.code), ["alice-2", "alice-1"]);
  const b = await list(bob);
  assert.deepEqual(b.json.links.map((l) => l.code), ["bob-1"]);
});

// --- delete -----------------------------------------------------------------------------

test("deleting someone else's link is 404 and changes nothing", async () => {
  await create(bob, { url: "https://b.test", code: "bobs" });
  const res = await del(alice, "bobs");
  assert.equal(res.status, 404);
  assert.equal(site.items(TYPE).length, 1);
  assert.equal((await open("bobs")).status, 302);
});

test("deleting your own link removes it and its redirect", async () => {
  await create(alice, { url: "https://a.test", code: "mine" });
  await create(bob, { url: "https://b.test", code: "theirs" });
  assert.equal((await del(alice, "mine")).status, 200);
  assert.deepEqual(site.items(TYPE).map((i) => i.code), ["theirs"]);
  assert.equal((await open("mine")).status, 404);
  assert.equal((await del(alice, "mine")).status, 404);
});

test("delete validates the code before using it in a selector", async () => {
  assert.equal((await del(alice, "a,#links")).status, 400);
  assert.equal((await site.request({ method: "DELETE", path: "/api/links", auth: alice })).status, 400);
});

// --- redirect ---------------------------------------------------------------------------

test("/s/{code} redirects with no-referrer and no caching", async () => {
  assert.equal((await create(alice, { url: "https://dest.test/x?y=1", code: "go1" })).status, 201);
  const res = await open("go1");
  assert.equal(res.status, 302);
  assert.equal(res.headers.Location, "https://dest.test/x?y=1");
  assert.equal(res.headers["Referrer-Policy"], "no-referrer");
  assert.equal(res.headers["Cache-Control"], "private, no-store");
});

test("unknown or malformed codes get the HTML 404 page", async () => {
  for (const code of ["nope123", "x", "../etc"]) {
    const res = await open(code);
    assert.equal(res.status, 404);
    assert.match(res.body, /Link not found/);
    assert.match(res.headers["Content-Type"], /text\/html/);
  }
});

test("redirect refuses a stored non-http URL (defense in depth)", async () => {
  site.post(
    `<li id="l-evil" itemscope itemtype="${TYPE}"><meta itemprop="code" content="evil"><meta itemprop="url" content="javascript:alert(1)"><meta itemprop="owner" content="x"><meta itemprop="created" content="1"></li>`,
    "/data/links.html", "#links"
  );
  assert.equal((await open("evil")).status, 404);
});
