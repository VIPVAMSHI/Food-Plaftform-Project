# Vercel audit (Phase 1, diagnosis only)

Branch `vercel-ready` from `demo-final` at f96f7bc. Checked 2026-11-24.

## Most likely cause of "doesn't work on other people's devices"

Two things, either of which is enough on its own:

1. **There is no Vercel backend at all.** The repo has no `vercel.json` and no `api/` folder. A Vercel import of `hux0725/main` (identical to `demo-final`, merged via PR #1) deploys only the static Vite build. In the browser:
   - Discover still renders, because the places are bundled.
   - The assistant still answers, because it falls back to the on-device matcher.
   - Every `/api/*` call gets Vercel's 404, so plans and favorites show "Couldn't reach the server". No env file can fix this: there is no server for the env vars to configure.
2. **Deployment Protection.** Vercel's Standard Protection, the recommended default, protects every deployment URL except the production domains. If people were sent a preview or deployment URL (`<project>-<hash>-<team>.vercel.app`), they hit a Vercel login wall. The owner, who is logged in, sees the app fine.

"The env file" is a red herring for the deployed site. `server/.env` is gitignored, so it is never deployed, and Vercel never reads it. Env values have to be entered in Vercel Project Settings, and they only apply to deployments made afterwards.

## Findings

### 1. Vercel config, link, CLI

| Item | Status | Detail |
|---|---|---|
| `vercel.json`, `.vercel/`, `api/` | PROBLEM | None exist, and none are in git history. Vercel would treat this as a static Vite site. |
| Linked Vercel project | UNSURE | No `.vercel/project.json` locally. GitHub shows no deployment records for either repo. `food-plaftform-project.vercel.app` and three name variants return 404. A project may still exist under another name. |
| `vercel` CLI | PROBLEM | Not installed and not logged in (no `~/.vercel`). It can run through `npx vercel@latest`. |

### 2. Environment variables

The server reads everything once, in `server/src/env.ts` (`loadEnv`), when `buildApp` runs. In the Vercel function that means module/cold-start time, not request time. The front end reads no env vars except Vite's built-in `import.meta.env.DEV` (`src/ai/useAiStatus.ts:32`). There are **no `VITE_` variables**, so nothing secret can reach the bundle.

| Variable | Read in | Required | Default | In `.env.example` |
|---|---|---|---|---|
| NODE_ENV | env.ts | no | development | yes |
| PORT, HOST | env.ts, index.ts | no (local only) | 3001, 127.0.0.1 / 0.0.0.0 | yes |
| DB_PATH | env.ts, index.ts:75 | no | ./data/bite.db | yes |
| CACHE_PATH | env.ts | no | ./data/assistant-cache.json | yes |
| LOG_LEVEL | env.ts | no | info | yes |
| LLM_PROVIDER | env.ts | no | google | yes |
| LLM_MODEL | env.ts | yes, if a key is set; otherwise startup throws | none | yes |
| LLM_API_KEY | env.ts | no | none | yes |
| DEMO_DEBUG | env.ts | no | false | yes |
| AI_KEY_PROMPT | env.ts | no | on in dev, off in production | yes (commented) |
| DEV_ORIGIN | env.ts | no | http://localhost:5173 | **missing** |
| E2E_BASE_URL, E2E_PORT, PREFLIGHT_URL | playwright.config.ts, preflight.mjs | test tooling only | | n/a |

- PROBLEM: no database URL or token variables exist yet. They are needed for a hosted DB.
- PROBLEM: the env is validated when the module loads. A bad value (for example a key without `LLM_MODEL`) throws inside `buildApp`, so on Vercel the whole function crashes on every request instead of reporting the problem in `/api/health`.
- OK: no `VITE_` variables and no secrets in the front end.

### 3. Persistent filesystem / long-running process

| What | Where | Status |
|---|---|---|
| SQLite file via `node:sqlite` (`mkdirSync` + WAL files) | db/index.ts:103-108 | PROBLEM. Vercel's filesystem is read-only, and `/tmp` is per instance and temporary. Data would vanish and differ between instances. |
| Schema migration on every boot | db/index.ts `#migrate` | PROBLEM. This is schema work on every cold start. |
| `seedPlaces` (upserts 68 rows) on every `buildApp` | app.ts:73 | PROBLEM. It writes on every cold start, and concurrent cold starts race. |
| Assistant cache JSON written after every LLM answer | assistant/cache.ts `#save` | PROBLEM. It can't write on Vercel, and it fails silently, so it's harmless but useless. |
| Cache prewarm on boot (calls the LLM up to 4×) | index.ts:40 | PROBLEM if moved into the function, since it would add cold-start cost. It's fine where it is (index.ts is the local entry only). |
| `LlmKeyStore` writes `server/.env` | llm/keyStore.ts | OK. `AI_KEY_PROMPT` is off when NODE_ENV=production, which Vercel functions use. |
| In-memory rate limiters (assistant 40/min, LLM 15/min, key 10/10 min) | rateLimit.ts | UNSURE. They work, but per instance only, so the limits are approximate. |
| Graceful shutdown, `app.listen`, port-in-use message | index.ts | OK. These are not used on Vercel; the function does not listen. |
| `process.uptime()` in health | health.ts | OK. It reports instance uptime. |
| Serving `dist/` with `@fastify/static` | app.ts:157 | OK. Vercel's CDN serves `dist/` instead, and the function must not need it. |

### 4. Hardcoded URLs and dev-only assumptions

- OK: the front end has no absolute API URLs. All calls are relative `/api/...` (`src/api/client.ts`).
- OK: the only absolute URLs are external services: open-meteo (weather, called by the browser and allowed in the CSP), Google AI Studio and the Gemini API.
- OK: the Vite proxy to `127.0.0.1:3001` is dev-server only.
- OK: CORS is registered only when NODE_ENV=development, and the deployed app is same-origin.
- OK: the "AI is off" banner and the key prompt only show when the server says `keyPromptEnabled`, or under `import.meta.env.DEV` (false in builds).
- PROBLEM (tooling): `preflight.mjs` and `tests/lighthouse/run.mjs` default to `127.0.0.1:3001`. Preflight's plan probe has no client id, and its "Demo data" check assumes one shared user.

### 5. Front-end API calls on a static-only deploy

The front end uses relative `/api` paths, which is correct for Vercel. On a static-only deploy:
- **Discover:** OK, from the bundled data.
- **Assistant:** OK. `askFoodAssistant` falls back to the on-device matcher with no error.
- **Plans and favorites:** PROBLEM. They show "Couldn't reach the server" plus a Retry button.
- **Deep links:** PROBLEM. Without an SPA rewrite, a hard refresh on `/plans` returns Vercel's 404.

### 6. Existing deployment checked as a stranger

UNSURE. I couldn't find a Vercel URL. To check in the dashboard:
1. Project → **Deployments**: does a production deployment exist, and which URL was shared? A `-<hash>-` URL is a deployment URL, protected under Standard Protection.
2. **Settings → Deployment Protection**: the Vercel Authentication setting.
3. **Settings → Environment Variables**: which environments each variable applies to.
4. **Settings → Build and Deployment**: the framework preset should be Vite, with output `dist`.

### 7. Node version and native modules

- PROBLEM: `"engines": { "node": ">=22.13" }`. Vercel maps `>=22.0.0` to the latest **26.x**, but every test here ran on 22.23.5. It needs to be pinned to a 22.x range.
- OK: the brief assumes better-sqlite3, but this code uses `node:sqlite` (DECISIONS #2). No native build is involved. Still unusable on Vercel because of item 3.

### 8. CORS, headers, rate limits behind Vercel's proxy

| Item | Status | Detail |
|---|---|---|
| Client IP | OK | `trustProxy: production`. Vercel overwrites `X-Forwarded-For` with the real client IP (docs: request headers), so `request.ip` is correct and can't be spoofed through Vercel. |
| Rate limiting | UNSURE | Per instance only, and resets on cold start. Acceptable for a demo; to be documented. |
| CORS | OK | Same-origin; dev only. |
| Security headers | PROBLEM | Helmet sets CSP, HSTS and the others on Fastify responses only. On Vercel, `index.html` and the assets come from the CDN, so the page itself would ship with **no CSP or other security headers** unless `vercel.json` adds them. |

### Other

- PROBLEM: one shared user, `DEMO_USER_ID = 'demo-user'` (`server/src/user.ts`). On a public URL every visitor sees and edits everyone's plans and favorites.
- PROBLEM: `/api/health` requires the DB to hold 68 places. With places served from code, health needs a new definition.
- NOTE: the brief says 35 restaurants, but the dataset is 68 (DECISIONS #3, owner's choice). Checks use 68.
- NOTE: no Gemini key is configured locally (`LLM_API_KEY` is empty), so the live-model check is blocked until one is provided.

## Prioritized fix list

**MUST**
1. Add an API function (`api/index.ts` wrapping the Fastify app) plus `vercel.json`: build command, `dist` output, `/api/*` rewrite, SPA fallback, `maxDuration`.
2. Move plans and favorites to a hosted DB (Turso, via `@libsql/client`), with `file:` for local use and tests. Serve places from the bundled dataset. Use a migration script instead of boot-time schema and seeding.
3. Read and validate env vars per request, so health reports what's missing instead of the function crashing.
4. Anonymous per-browser id (header), validated on the server, scoping every query. Per-id caps.
5. Assistant cache: a bundled read-only JSON plus in-memory at runtime. No disk writes on Vercel.
6. Security headers (CSP and others) for CDN-served files, in `vercel.json`.
7. Pin Node to 22.x.
8. VERCEL_DEPLOY.md, including the Deployment Protection setting.

**SHOULD**
9. Health booleans for each required variable, DB reachability and the LLM key.
10. Preflight works against a Vercel URL (client id, Vercel 404 detection, protection-wall detection).
11. Add `DEV_ORIGIN` and the new DB variables to `.env.example`, with the Vercel environment scope for each.
12. `reset-demo` with a production guard.

**NICE**
13. Lighthouse script takes a URL argument (it already does); document it.
14. Note that the rate limiter is approximate per instance.
