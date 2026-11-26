// Generic Pagelove HTTP steps. App-specific wording belongs in features, not here.
import { Given, When, Then, Before, After } from "@cucumber/cucumber";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { sessionFile } from "./world.mjs";

// Scenarios tagged @session:<name> are skipped (not failed) when that session isn't saved.
Before(function ({ pickle }) {
  for (const tag of pickle.tags.map((t) => t.name)) {
    const m = /^@session:(.+)$/.exec(tag);
    if (m && !existsSync(sessionFile(m[1]))) return "skipped";
  }
});

After(async function () {
  // Cleanup runs as whoever registered it, in reverse order, and never throws.
  for (const { as, method, path } of this.cleanups.reverse()) {
    try {
      as ? this.signIn(as) : this.signOut();
      await this.http(method, path);
    } catch (e) {
      this.attach?.(`cleanup ${method} ${path} failed: ${e.message}`);
    }
  }
});

// ---- who ------------------------------------------------------------------
Given("I am anonymous", function () { this.signOut(); });
Given("I am signed in as {string}", function (name) { this.signIn(name); });

// ---- requests ---------------------------------------------------------------
When(/^I (GET|HEAD|DELETE) "([^"]+)"$/, async function (method, path) {
  this.last = await this.http(method, path);
});

When(/^I (POST|PUT|PATCH) to "([^"]+)" with JSON:$/, async function (method, path, doc) {
  this.last = await this.http(method, path, { json: doc });
});

When(/^I (POST|PUT|PATCH) to "([^"]+)" (\d+) times at once with JSON:$/, async function (method, path, n, doc) {
  this.responses = await Promise.all(Array.from({ length: Number(n) }, () => this.http(method, path, { json: doc })));
  this.last = this.responses.find((r) => r.status < 300) ?? this.responses[0];
});

When("I remember {string} as {string}", function (jsonPath, name) {
  const v = jsonPath.split(".").reduce((o, k) => o?.[k], this.last?.json);
  assert.notEqual(v, undefined, `No ${jsonPath} in last response: ${this.last?.text?.slice(0, 200)}`);
  this.saved[name] = v;
});

Given(/^afterwards I (DELETE|POST|PUT) "([^"]+)"$/, function (method, path) {
  this.cleanups.push({ as: this.as, method, path: this.interpolate(path) });
});

// ---- assertions ----------------------------------------------------------------
Then("the status is {int}", function (status) {
  assert.equal(this.last.status, status, `${this.last.hint ?? ""}\nBody: ${this.last.text.slice(0, 300)}`);
});

Then("the status is one of {string}", function (list) {
  const allowed = list.split(/[,\s]+/).filter(Boolean).map(Number);
  assert.ok(allowed.includes(this.last.status), `Got ${this.last.status}, expected one of ${allowed}`);
});

Then("exactly {int} response(s) has/have status {int}", function (n, status) {
  const got = this.responses.map((r) => r.status);
  assert.equal(got.filter((s) => s === status).length, n, `Statuses: ${got.join(", ")}`);
});

Then("every other response has status {int}", function (status) {
  const got = this.responses.map((r) => r.status);
  const winners = got.filter((s) => s < 300).length;
  assert.equal(got.filter((s) => s === status).length, got.length - winners, `Statuses: ${got.join(", ")}`);
});

Then("the header {string} is {string}", function (name, value) {
  assert.equal(this.last.headers.get(name), this.interpolate(value));
});

Then("the header {string} contains {string}", function (name, value) {
  assert.ok((this.last.headers.get(name) ?? "").includes(this.interpolate(value)), `${name}: ${this.last.headers.get(name)}`);
});

Then("the body contains {string}", function (text) {
  assert.ok(this.last.text.includes(this.interpolate(text)), `Body: ${this.last.text.slice(0, 300)}`);
});

Then("the JSON {string} is {string}", function (path, value) {
  const v = path.split(".").reduce((o, k) => o?.[k], this.last.json);
  assert.equal(String(v), this.interpolate(value));
});

Then("the JSON list {string} has an item with {string} = {string}", function (path, key, value) {
  const arr = path.split(".").reduce((o, k) => o?.[k], this.last.json) ?? [];
  assert.ok(arr.some((i) => String(i[key]) === this.interpolate(value)), `No ${key}=${value} in ${path}`);
});

Then("the JSON list {string} has no item with {string} = {string}", function (path, key, value) {
  const arr = path.split(".").reduce((o, k) => o?.[k], this.last.json) ?? [];
  assert.ok(!arr.some((i) => String(i[key]) === this.interpolate(value)), `Found ${key}=${value} in ${path}`);
});

Then("the response does not mention {string}", function (text) {
  assert.ok(!this.last.text.includes(this.interpolate(text)));
});
