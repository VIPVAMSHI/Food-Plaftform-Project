# Final report: Seattle Food Discovery on Vercel (branch `vercel-ready`)

The earlier stage-demo report (Render, `demo-final`) is at tag `demo-ready-v1`: `git show demo-ready-v1:FINAL_REPORT.md`.

## 1. Status

**Ready to deploy, not deployed yet.** The app builds with `vercel build`. The built function and static files pass everything locally, run through a local copy of Vercel's routing with a real libSQL server standing in for Turso. A real Preview or Production deployment needs three things from you (section 6): a Vercel login, a Turso database, and optionally a Gemini key.

- **URL:** none yet (NOT RUN). After step 3 of VERCEL_DEPLOY.md it will be `https://<project>.vercel.app`.
- **Why "it didn't work on other devices" before:** there was no backend on Vercel. Only the static site was served, so every `/api/*` call returned 404. Possibly Deployment Protection also put a login wall on preview URLs. Both are fixed or documented (VERCEL_AUDIT.md, VERCEL_DEPLOY.md step 4).

## 2. What changed

- **API on Vercel:** one Fastify function (`api/index.ts`). `vercel.json` sets the build, the `/api` rewrite, the SPA fallback, security headers, a 15 s max duration, and leaves native SQLite code out of the bundle.
- **Data:** plans and favorites moved to libSQL (Turso on Vercel, a local file for `npm start` and tests). Places ship with the code. Schema changes go through `npm run db:migrate`. `reset-demo` needs `--production` for a remote database. Render keeps working through `DB_PATH`.
- **Per-browser data:** an anonymous id in localStorage, sent as `X-Client-Id`, so each browser sees only its own plans and favorites (no login; `TODO(auth)` kept). Pre-backend localStorage data uploads under the new id once.
- **Limits:** 50 plans per browser. Rate limits are per browser with a per-IP ceiling, so a room on one Wi-Fi still works.
- **Health:** `/api/health` returns booleans only (database URL/token/reachable/schema, key, model), plus the names of ignored invalid settings. Bad configuration never crashes the function.
- **Assistant:** fallback chain unchanged (model → cache → local, with `source`). Bundled demo cache (`npm run cache:build`) plus an in-memory cache.
- **Docs and tools:** VERCEL_DEPLOY.md, `server/.env.example` (every variable), preflight for Vercel (login wall, static-only 404, missing settings), and `scripts/vercel-local.mjs`.
- **Fixed on the way:** extensionless ESM imports would have crashed every API call on Vercel (now covered by a test); the default local database file stays `server/data/bite.db`; old `bite.db` files upgrade in place.

## 3. Test evidence (run on this machine, Node 22.23.5)

| Check | Result |
| --- | --- |
| `npm ci` (fresh copy, during `vercel build`) | PASS: 297 + 107 packages |
| `npm run typecheck`, `npm run lint`, `npm run build` | PASS |
| `npm test` (unit + API) | PASS 138/138 (was 100; nothing removed or weakened) |
| `npm run test:e2e` (local `npm start`; Chrome 1440/1920, mobile 390, Safari) | PASS 177/177 |
| `npm run test:eval` (local) | PASS 50/50 |
| `npm run test:chaos` | PASS 10/10 (includes Render's `DB_PATH` and kill -9 during writes) |
| `npm run test:security` | PASS 9/9 (`.env` never committed, no keys in history/tree/dist, logs clean, npm audit 0) |
| `npm run scan:dist` | PASS: GREEN |
| `vercel build` (CLI 66.6.0, offline) | PASS: `nodejs22.x`, maxDuration 15, 6.4 MB function, no native `.node` files |
| Vercel output secret scan (858 files: static + function) | PASS: 0 findings, no `.env` bundled, scanner verified on known tokens |
| e2e against the built Vercel output (mobile-390 + desktop 1440) | PASS 89/89 |
| Demo-script path ×10 against the built Vercel output (mobile + desktop) | PASS 100/100 tests; full demo path 20/20 |
| Preflight against the built Vercel output | PASS: 16 green, 1 yellow (no LLM key) |
| Two devices: isolation, persistence, hard refresh, no console errors | PASS (e2e `devices.spec.ts`, Chrome, mobile, Safari) |
| Failure: no LLM key | PASS: assistant answers locally, no visible error |
| Failure: wrong database token (libSQL server with JWT auth) | PASS: health 503 `databaseReachable: false`, plans show a friendly message, places and assistant work, preflight says "check DATABASE_URL and DATABASE_AUTH_TOKEN", token not in any log |
| Failure: `DATABASE_URL` missing | PASS: health names it, preflight gives the fix |
| Failure: Deployment Protection wall / static-only deploy | PASS: preflight detects both (simulated responses) |
| Cold start (local, built function) | ~135 ms to load + ~60 ms first API call; warm calls ~3 ms |

Artifacts: `artifacts/` (Playwright report, chaos, security, eval).

## 4. NOT RUN

- **Preview and Production deployment, and every check against them** (preflight, `E2E_BASE_URL` on mobile-390 and desktop, demo path ×10, real cold start): needs a Vercel login and a Turso database.
- **Real Turso:** tested against `sqld` (the libSQL server Turso runs), over the same HTTP protocol, with and without auth.
- **Real Gemini call and model confirmation:** no key on this machine. Covered by a fake Gemini server in the API tests.
- **`vercel dev`:** needs a login. `vercel build` plus the local router was used instead.
- **Lighthouse:** not rerun (front end unchanged except one request header).

## 5. Open issues and assumptions

- **Rate limits are per function instance** (in memory), so they're approximate on Vercel. They stop a runaway script, not a determined attacker.
- **Vercel's body helper:** read from `@vercel/node` 32 and reproduced locally. The first Preview deploy confirms it (any saved plan proves it).
- **No login:** clearing site data or switching browsers starts an empty profile. Plans saved under the old shared `demo-user` stay in old local databases but aren't shown.
- **UNSURE:** Turso and Vercel regions. Put the database near the function region (Vercel's default is US East) to keep each save fast. Not measured.
- **Assumption:** Hobby plan; Node 22 is pinned (Vercel's default is 26).
- **Housekeeping:** the project folder contains macOS/iCloud duplicate files named `* 2.*` (for example in `node_modules` and `server/data`). They're harmless and untracked, but worth cleaning up.
- **Still open from before:** whether to move the `demo-ready-v1` tag.

## 6. MANUAL CHECKLIST

1. Push: `git push -u origin vercel-ready` (done by the agent if credentials allow; see PROGRESS.md).
2. Turso: install the CLI, `turso db create seattle-food`, then `turso db show seattle-food --url` and `turso db tokens create seattle-food` (VERCEL_DEPLOY.md step 2).
3. Run `npm run db:migrate` with that URL and token. It should print `schema 0 → 1`.
4. Vercel: Import the repo at https://vercel.com/new and pick the `vercel-ready` branch (or merge it first). Add `DATABASE_URL` and `DATABASE_AUTH_TOKEN` (Sensitive) for Production and Preview. Optionally add `LLM_API_KEY` (Sensitive) and `LLM_MODEL=gemini-2.5-flash-lite`. Then Deploy.
5. Settings → Deployment Protection: share the **production** domain, or set Vercel Authentication to Disabled if previews must be public.
6. Run `npm run preflight -- https://<project>.vercel.app`. Everything should be GREEN, or YELLOW only for "LLM key" if you set none.
7. Run `E2E_BASE_URL=https://<project>.vercel.app npx playwright test --project=mobile-390 --project=chromium-1440`.
8. On two phones (one on cellular), open the URL. The restaurant list shows, a saved place survives a reload, and the other phone doesn't see it.
9. Optional, with a key: `npm run cache:build`, commit `server/src/assistant/demoCache.ts`, and redeploy.
10. Before an audience: `npm run reset-demo -- --production` (with the Turso env set) for a clean slate.
