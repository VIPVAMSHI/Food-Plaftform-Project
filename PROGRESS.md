# Progress

Read this and DECISIONS.md first after a context reset.

## Current: Vercel mission (branch `vercel-ready`, from `demo-final` f96f7bc)
- Phase 1 (diagnose): done → VERCEL_AUDIT.md.
- Phase 2 (restructure): done (decisions #39–55).
  - 2A hosting: `api/index.ts` → `server/src/vercel.ts` (one Fastify function), `vercel.json` (build, rewrites, SPA fallback, headers, maxDuration 15, native libsql excluded).
  - 2B database: `@libsql/client` (Turso / `file:`), `DATABASE_URL` + `DATABASE_AUTH_TOKEN` (`DB_PATH` still works for Render), places from the bundled dataset, `npm run db:migrate`, `reset-demo` needs `--production` for remote.
  - 2C per-browser data: anonymous UUID in localStorage → `X-Client-Id`; 50 plans per visitor; 60 writes/min per visitor, 600 per IP.
  - 2D assistant: fallback chain unchanged; bundled demo cache (`npm run cache:build`) + in-memory cache; env read on first request per instance.
  - 2E docs: server/.env.example (every variable, Vercel yes/no), VERCEL_DEPLOY.md, README.
  - Tests updated: API tests send a visitor id; new tests for isolation, id validation, plan cap (racing), write limits, DB down, unmigrated DB, upgrade from the old bite.db, lenient env, Vercel handler. e2e: fresh visitor per test (`visitorId`/`api` fixtures). Chaos/security/Playwright use `DATABASE_URL`.
- Phase 3 (test): next. Local Vercel emulation: `vercel build` → `scripts/vercel-local.mjs` on :3200 with `sqld` on :8080.

## Blockers (user)
- No Vercel login/token, no Turso credentials, no Gemini key on this machine, no GitHub push credentials.

## Earlier (demo-final, tag `demo-ready-v1`)
- All demo phases done; Render deploy prepared (render.yaml, DEPLOY.md). See FINAL_REPORT.md.
