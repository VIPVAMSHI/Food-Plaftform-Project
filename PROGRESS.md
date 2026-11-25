# Progress

Read this and DECISIONS.md first after a context reset.

## Current: Vercel mission (branch `vercel-ready`, from `demo-final` f96f7bc), tag `vercel-ready-v1`
- Phase 1 (diagnose): done → VERCEL_AUDIT.md.
- Phase 2 (restructure): done (decisions #39–55). Hosting, libSQL/Turso, per-browser ids, assistant cache, docs.
- Phase 3 (test): done locally → FINAL_REPORT.md section 3. Found and fixed: per-IP limits cutting off a shared Wi-Fi (now per browser, #46); Vercel body helper reproduced in the local router (#56).
- Phase 4: FINAL_REPORT.md, preflight for Vercel, tag. Production deploy NOT RUN (no Vercel login / Turso).

How to re-run the local Vercel check: `vercel build` in a copy with `.vercel/project.json` → `node scripts/vercel-local.mjs <copy>/.vercel/output 3200` with `DATABASE_URL` pointing at `sqld` (`sqld --http-listen-addr 127.0.0.1:8080`), then `E2E_BASE_URL=http://127.0.0.1:3200 npx playwright test --project=mobile-390 --project=chromium-1440`.

## Blockers (user)
- Vercel login (or token), a Turso database URL + token, optionally a Gemini key. Exact steps: FINAL_REPORT.md section 6.

## Earlier (demo-final, tag `demo-ready-v1`)
- All demo phases done; Render deploy prepared (render.yaml, DEPLOY.md).
