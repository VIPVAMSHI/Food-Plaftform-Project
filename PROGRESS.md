# Progress

Read this and DECISIONS.md first after a context reset.

## Current
- Phase: 3 (testing). Unit + API tests and eval written and passing locally.
- Next action: Playwright e2e + axe (T5/T6), then Lighthouse, chaos, security, soak; then demo kit (2E) and preflight.

## Done
- Phase 1 audit: AUDIT.md written. Build was clean before changes (0 errors, 0 warnings). Commit 90eebff.
- Phase 2A server: /server package, env validation, helmet/CSP, dev-only CORS, 32 KB body limit, error shape, SIGTERM, /api/health.
- Phase 2B persistence: node:sqlite, plans + favorites with foreign keys, idempotent seed, zod-validated routes, 400/404/409, past-date rule, `npm run seed` / `npm run reset-demo`.
- Phase 2C assistant: code-side filtering, Anthropic provider (no hardcoded model, 6 s deadline, 1 retry), grounded JSON picks, cache → llm → local chain, persisted demo cache, rate limits, safe logging.
- Phase 2D front end: API client, plans/favorites via API with one-time localStorage migration, optimistic heart, loading/error/empty states, error boundary, Seattle clock, live weather with fallback, location rerank, mic handling, self-hosted fonts, photo compression, contrast + font-size + 44 px targets, projector zoom.
- Phase 3 (partial): ESLint (errors only) clean; Vitest 90/90; eval 50/50 local (live NOT RUN: no key); dist secret scan GREEN.

## Open / blocked
- LLM_API_KEY is empty in server/.env: live-LLM checks will be NOT RUN until a key is provided. Everything else uses a mocked model.
- Deploy credentials: none yet (Phase 4).
