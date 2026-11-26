// Pagelove trigger harness — runs a site's JavaScript triggers offline.
//
// Loads triggers.html + schema.html + data documents from a local site folder,
// rewrites Schema imports to in-memory fakes, provides a fake global `Pagelove`
// (PUT / POST / DELETE on in-memory DOMs), enforces schema `unique` rules on
// writes, and returns the HTTPResponse a trigger throws.
//
// What it does NOT emulate (cover these with E2E tests against the real host):
// authorization rules, trigger gates, shape/transition constraints, composition,
// caching, and real session/auth objects (you pass `auth` yourself).
//
// Usage:
//   import { loadSite } from "./harness.mjs";
//   const site = await loadSite("../pagelove");
//   const res = await site.request({ method: "POST", path: "/api/x", body: {...}, auth: { sub: "alice" } });
//   res.status, res.json, res.headers, site.doc("/data/x.html")

import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { parseHTML } from "linkedom";

const SCHEMA_IMPORT =
  /import\s+(\w+)\s+from\s+(["'])([^"']+)\2\s+with\s*\{\s*type\s*:\s*(["'])https:\/\/pagelove\.org\/Schema\4\s*\}\s*;?/g;
const HTTP_RESPONSE = "https://pagelove.org/HTTPResponse";

// ---- microdata ------------------------------------------------------------

function ownerItem(el) {
  let p = el.parentElement;
  while (p && !p.hasAttribute("itemscope")) p = p.parentElement;
  return p;
}

function propValue(el) {
  if (el.hasAttribute("itemscope")) return readItem(el);
  const tag = el.tagName.toLowerCase();
  if (tag === "meta") return el.getAttribute("content") ?? "";
  if (["a", "link", "area"].includes(tag)) return el.getAttribute("href") ?? "";
  if (["img", "audio", "video", "source", "iframe", "embed"].includes(tag)) return el.getAttribute("src") ?? "";
  if (tag === "time") return el.getAttribute("datetime") ?? el.textContent.trim();
  if (["data", "meter"].includes(tag)) return el.getAttribute("value") ?? "";
  return el.textContent.trim();
}

/** Read an itemscope element into a plain object (repeated props become arrays). */
export function readItem(el) {
  const out = {};
  for (const p of el.querySelectorAll("[itemprop]")) {
    if (ownerItem(p) !== el) continue;
    for (const name of p.getAttribute("itemprop").split(/\s+/).filter(Boolean)) {
      const v = propValue(p);
      if (!(name in out)) out[name] = v;
      else out[name] = [].concat(out[name], v);
    }
  }
  return out;
}

function itemsOfType(document, type) {
  return [...document.querySelectorAll("[itemscope][itemtype]")].filter((el) =>
    el.getAttribute("itemtype").split(/\s+/).includes(type)
  );
}

// ---- site loading -----------------------------------------------------------

async function listHtml(dir) {
  const out = [];
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) out.push(...(await listHtml(p)));
    else if (ent.name.endsWith(".html")) out.push(p);
  }
  return out;
}

function globToRegExp(glob) {
  const re = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp("^" + re + "$");
}

function parseSchemas(documents) {
  const schemas = new Map(); // type -> { name, uniqueGroups: Map<group, [prop]> }
  for (const document of documents) {
    for (const el of itemsOfType(document, "https://pagelove.org/Schema")) {
      const s = readItem(el);
      const props = [].concat(s.property ?? []);
      const groups = new Map();
      for (const p of props) {
        const u = p.unique == null ? "" : String(p.unique);
        if (!u || u === "false") continue;
        const key = u === "true" ? "__single__" + p.name : u; // same non-"true" value => composite group
        groups.set(key, [...(groups.get(key) ?? []), p.name]);
      }
      schemas.set(String(s.type), { name: s.name, properties: props.map((p) => p.name), uniqueGroups: groups });
    }
  }
  return schemas;
}

function parseTriggers(document) {
  return itemsOfType(document, "https://pagelove.org/Trigger").map((el, index) => {
    const t = readItem(el);
    const resources = [].concat(t.resource ?? []).map(String);
    const methods = [].concat(t.method ?? []).map((m) => String(m).toUpperCase());
    const script = [...el.querySelectorAll('script[itemprop="source"]')].find((s) => {
      const action = s.closest('[itemprop="action"]');
      return action && ownerItem(action) === el;
    });
    return {
      index,
      resources,
      matchers: resources.map(globToRegExp),
      methods,
      source: script ? script.textContent : null,
    };
  });
}

// One module per trigger source, shared across sites; calls are routed to the
// active site via globalThis.__plHarness.current.
const moduleCache = new Map();
globalThis.__plHarness ??= {
  current: null,
  schema(type) {
    return {
      search(filter = {}) {
        const site = globalThis.__plHarness.current;
        if (!site) throw new Error("harness: no active site");
        return site.search(type, filter);
      },
    };
  },
};
globalThis.Pagelove = {
  PUT: (...a) => active().put(...a),
  POST: (...a) => active().post(...a),
  DELETE: (...a) => active().del(...a),
};
function active() {
  const s = globalThis.__plHarness.current;
  if (!s) throw new Error("harness: Pagelove.* called outside a request");
  return s;
}

async function loadModule(source) {
  if (moduleCache.has(source)) return moduleCache.get(source);
  const rewritten = source.replace(SCHEMA_IMPORT, (_m, name, _q, type) =>
    `const ${name} = globalThis.__plHarness.schema(${JSON.stringify(type)});`
  );
  const url = "data:text/javascript;base64," + Buffer.from(rewritten).toString("base64");
  const mod = await import(url);
  moduleCache.set(source, mod);
  return mod;
}

// ---- the site --------------------------------------------------------------

/**
 * @param {string} root  local folder mirroring the site (e.g. "pagelove/")
 * @param {object} [opts]
 * @param {string} [opts.triggers="system/triggers.html"]
 * @param {string[]} [opts.schemas=["system/schema.html"]]
 * @param {string} [opts.host="example.test"]  value for ctx.request.host
 */
export async function loadSite(root, opts = {}) {
  const host = opts.host ?? "example.test";
  const docs = new Map(); // "/path.html" -> linkedom document
  for (const file of await listHtml(root)) {
    const urlPath = "/" + relative(root, file).split(sep).join("/");
    docs.set(urlPath, parseHTML(await readFile(file, "utf8")).document);
  }
  const triggerDoc = docs.get("/" + (opts.triggers ?? "system/triggers.html"));
  if (!triggerDoc) throw new Error("harness: triggers file not found under " + root);
  const schemaDocs = (opts.schemas ?? ["system/schema.html"]).map((p) => docs.get("/" + p)).filter(Boolean);
  const schemas = parseSchemas(schemaDocs);
  const triggers = parseTriggers(triggerDoc);
  const isSystem = (p) => p.startsWith("/system/");

  function getDoc(path) {
    const d = docs.get(path);
    if (!d) throw new Error(`harness: no document at ${path}`);
    return d;
  }

  function search(type, filter) {
    const out = [];
    for (const [path, document] of docs) {
      if (isSystem(path)) continue;
      for (const el of itemsOfType(document, type)) {
        const item = readItem(el);
        const ok = Object.entries(filter).every(([k, v]) =>
          [].concat(item[k] ?? []).map(String).includes(String(v))
        );
        if (ok) out.push(item);
      }
    }
    return out;
  }

  function checkUnique() {
    for (const [type, s] of schemas) {
      for (const [group, props] of s.uniqueGroups) {
        const seen = new Set();
        for (const item of search(type, {})) {
          const key = JSON.stringify(props.map((p) => item[p] ?? null));
          if (seen.has(key)) {
            const label = group.startsWith("__single__") ? props[0] : group;
            throw new Error(`unique constraint violated: ${label} on ${type}`);
          }
          seen.add(key);
        }
      }
    }
  }

  // Apply a mutation; roll the document back and throw if a unique rule breaks.
  function mutate(path, fn) {
    const document = getDoc(path);
    const before = document.toString();
    fn(document);
    try {
      checkUnique();
    } catch (e) {
      docs.set(path, parseHTML(before).document);
      throw e;
    }
  }

  function fragment(document, item) {
    const html = typeof item === "string" ? item : item?.outerHTML;
    if (typeof html !== "string") throw new Error("harness: item must be an HTML string or element");
    const t = document.createElement("template");
    t.innerHTML = html;
    return [...t.content.childNodes];
  }

  function target(document, selector, path) {
    const el = selector ? document.querySelector(selector) : document.body;
    if (!el) throw new Error(`harness: selector ${selector} matched nothing in ${path}`);
    return el;
  }

  const site = {
    host,
    triggers,
    schemas,
    search,
    doc: (path) => getDoc(path).toString(),
    setDoc: (path, html) => void docs.set(path, parseHTML(html).document),
    items: (type) => search(type, {}),

    put(item, path, selector) {
      if (!selector) {
        const html = typeof item === "string" ? item : item.outerHTML;
        const before = docs.get(path)?.toString();
        docs.set(path, parseHTML(html).document);
        try { checkUnique(); } catch (e) { before ? docs.set(path, parseHTML(before).document) : docs.delete(path); throw e; }
        return;
      }
      mutate(path, (d) => target(d, selector, path).replaceWith(...fragment(d, item)));
    },

    post(item, path, selector, placement = "append") {
      mutate(path, (d) => {
        const el = target(d, selector, path);
        const nodes = fragment(d, item);
        if (placement === "append") el.append(...nodes);
        else if (placement === "prepend") el.prepend(...nodes);
        else if (placement === "before") { if (!selector) throw new Error("before needs a selector"); el.before(...nodes); }
        else if (placement === "after") { if (!selector) throw new Error("after needs a selector"); el.after(...nodes); }
        else throw new Error(`harness: unknown placement ${placement}`);
      });
    },

    del(path, selector) {
      if (!selector) return void docs.delete(path);
      mutate(path, (d) => d.querySelectorAll(selector).forEach((el) => el.remove()));
    },

    /**
     * Run the trigger chain for a request.
     * @returns {{status:number|null, headers:object, body:string, json:any, passthrough:boolean, error?:Error}}
     *   passthrough=true means no trigger answered (core processing would run).
     */
    async request({ method = "GET", path, query, body, rawBody, headers = {}, auth = null } = {}) {
      method = method.toUpperCase();
      let q = { ...(query ?? {}) };
      const qi = path.indexOf("?");
      if (qi >= 0) {
        for (const [k, v] of new URLSearchParams(path.slice(qi + 1))) q[k] = v;
        path = path.slice(0, qi);
      }
      if (rawBody === undefined && typeof body === "string") rawBody = body;
      const ctx = { request: { method, path, host, query: q, body, rawBody, headers, auth } };
      const chain = triggers.filter(
        (t) => t.source && t.matchers.some((m) => m.test(path)) && (t.methods.length === 0 || t.methods.includes(method))
      );
      globalThis.__plHarness.current = site;
      try {
        for (const t of chain) {
          const mod = await loadModule(t.source);
          try {
            await mod.default(ctx);
          } catch (thrown) {
            if (thrown && thrown.schema_url === HTTP_RESPONSE) {
              const res = {
                status: thrown.status ?? 200,
                headers: thrown.headers ?? {},
                body: thrown.body ?? "",
                passthrough: false,
                trigger: t.index,
              };
              try { res.json = JSON.parse(res.body); } catch { res.json = undefined; }
              return res;
            }
            return { status: 500, headers: {}, body: String(thrown?.stack ?? thrown), json: undefined, passthrough: false, error: thrown, trigger: t.index };
          }
        }
        return { status: null, headers: {}, body: "", json: undefined, passthrough: true };
      } finally {
        globalThis.__plHarness.current = null;
      }
    },
  };
  return site;
}
