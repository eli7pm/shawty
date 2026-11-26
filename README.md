# Shawty

**Long links, made shawty.** A link shortener built on [Pagelove](https://pagelove.com).
Sign in with Google, shorten a URL (with an optional custom code), and manage your
own list of links. Anyone with a short link can follow it.

Live at <https://grin-veil-8450.onpagelove.com>.

## Features

- Google sign-in (OIDC). Only signed-in users can create links.
- Random codes without look-alike characters, or custom codes (`3–32` letters,
  numbers, `-` and `_`).
- A private, per-user list of your links, with copy and delete buttons.
- Public redirects at `/s/{code}` (`302`, `Referrer-Policy: no-referrer`), and a
  friendly 404 page for unknown or deleted codes.
- Long URLs supported (up to 32,768 characters). Only `http(s)` URLs are
  accepted, and links back to Shawty's own `/s/` paths are refused to prevent
  loops.
- Links never expire. They work until you delete them.

## How it works

Pagelove apps are HTML documents. There is no separate backend server:

```
/                  React front end (static build of web/)
/api/me            JSON session probe         (trigger)
/api/links         list / create / delete     (trigger)
/s/{code}          public redirect            (trigger)
/data/links.html   private storage, one <li> microdata item per link
/system/*.html     authorization rules, schema, triggers (private)
```

- **Access** (`pagelove/system/authz.html`): the host denies unmatched GETs,
  so only the app shell, assets, `/api/me` and `/s/*` are public. `/api/links`
  is open to signed-in users only. Nothing allows direct access to `/data` or
  `/system`.
- **Data model** (`pagelove/system/schema.html`): a `ShortLink` has `code`
  (`unique`), `url`, `owner` and `created`. Pagelove enforces uniqueness on
  every write, so a code can never exist twice, even when two people claim it at
  the same moment.
- **Ownership** (`pagelove/system/triggers.html`): every link stores the
  creator's Google subject ID, taken from the session (never from the request).
  Lists filter on it. Deleting checks it, and a link you don't own gets `404`.
  The owner is never included in API responses.

## Repository layout

```
pagelove/   files deployed to the host, mirroring their site paths
  system/   authz.html, schema.html, triggers.html
  data/     links.html (an empty container; live data lives only on the host)
web/        front end: Vite, React 19, TypeScript, Tailwind v4, shadcn (base-nova)
tests/      unit tests (offline trigger harness) and Cucumber end-to-end tests
```

## Front end

```bash
cd web
npm install
npm run dev      # UI at http://localhost:5173
npm run build    # writes web/dist/
```

The dev server only serves the UI. `/api/*` and sign-in exist only on the
Pagelove host, so test signed-in features against a deployed site.

## Tests

```bash
cd tests
npm install
npm run test:unit   # 37 offline tests of the triggers, about 0.2s
npm run test:e2e    # Cucumber against the live host
```

- **Unit tests** run `triggers.html` in Node, using a harness that fakes
  Pagelove's storage and enforces the schema's `unique` rules. They cover
  validation, ownership, status codes, escaping and redirects.
- **End-to-end tests** check the real platform: public and private paths,
  access rules, concurrent duplicate codes, and isolation between users.
  Scenarios that need a login are skipped until you save one for each
  test account:

  ```bash
  npx playwright open --save-storage=.auth/alice.json https://grin-veil-8450.onpagelove.com/auth/login
  npx playwright open --save-storage=.auth/bob.json   https://grin-veil-8450.onpagelove.com/auth/login
  ```

  Use two dedicated Google test accounts. `.auth/` holds live sessions and is
  git-ignored. Signed-in scenarios create and delete only `zztest-` links.
  Point them at another host with `BASE_URL=https://… npm run test:e2e`.

The test tooling comes from [pl-test-kit](https://github.com/eli7pm/pl-test-kit).
