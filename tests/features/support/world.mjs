// Generic Pagelove E2E world: HTTP against the public host, optional saved
// browser sessions, {{placeholder}} interpolation and mandatory cleanup.
import { setWorldConstructor, World } from "@cucumber/cucumber";
import { readFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

export const BASE_URL = (process.env.BASE_URL ?? "").replace(/\/$/, "");
export const AUTH_DIR = process.env.AUTH_DIR ?? ".auth";
export const TEST_PREFIX = process.env.TEST_PREFIX ?? "zztest-";

export function sessionFile(name) {
  return `${AUTH_DIR}/${name}.json`;
}

// Build a Cookie header from a Playwright storage-state file for BASE_URL's host.
function cookieHeader(file) {
  const host = new URL(BASE_URL).hostname;
  const { cookies = [] } = JSON.parse(readFileSync(file, "utf8"));
  const now = Date.now() / 1000;
  return cookies
    .filter((c) => {
      const d = c.domain.replace(/^\./, "");
      return (host === d || host.endsWith("." + d)) && (c.expires == null || c.expires < 0 || c.expires > now);
    })
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

class PageloveWorld extends World {
  constructor(options) {
    super(options);
    if (!BASE_URL) throw new Error("Set BASE_URL, e.g. BASE_URL=https://your-site.onpagelove.com");
    this.run = TEST_PREFIX + randomBytes(3).toString("hex"); // unique per scenario
    this.as = null; // session name, or null for anonymous
    this.cookie = "";
    this.last = null; // { status, headers, text, json }
    this.responses = [];
    this.saved = {};
    this.cleanups = [];
  }

  signIn(name) {
    const file = sessionFile(name);
    if (!existsSync(file)) throw new Error(`No saved session ${file}. Capture one: npm run login -- ${file} ${BASE_URL}/auth/login`);
    this.as = name;
    this.cookie = cookieHeader(file);
  }

  signOut() {
    this.as = null;
    this.cookie = "";
  }

  // {{run}} -> unique id, {{saved.x}} -> remembered value, {{last.a.b}} -> last JSON path
  interpolate(text) {
    return String(text).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key) => {
      if (key === "run") return this.run;
      const [root, ...path] = key.split(".");
      const src = root === "saved" ? this.saved : root === "last" ? this.last?.json : undefined;
      const v = path.reduce((o, k) => (o == null ? undefined : o[k]), src);
      if (v === undefined) throw new Error(`Unknown placeholder {{${key}}}`);
      return String(v);
    });
  }

  async http(method, path, { json, headers = {} } = {}) {
    const url = new URL(BASE_URL + this.interpolate(path));
    if (method === "GET" || method === "HEAD") url.searchParams.set("cb", Date.now().toString(36) + this.run);
    const h = { Accept: "application/json, text/html;q=0.9", ...headers };
    if (this.cookie) h.Cookie = this.cookie;
    let body;
    if (json !== undefined) {
      h["Content-Type"] = "application/json";
      body = typeof json === "string" ? this.interpolate(json) : JSON.stringify(json);
    }
    const res = await fetch(url, { method, headers: h, body, redirect: "manual", cache: "no-store" });
    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = undefined; }
    const out = { status: res.status, headers: res.headers, text, json: parsed };
    if (this.as && res.status === 401 && !path.startsWith("/data") && !path.startsWith("/system")) {
      out.hint = `Got 401 while signed in as "${this.as}" — the saved session may have expired; re-capture it.`;
    }
    return out;
  }
}

setWorldConstructor(PageloveWorld);
