# Decisions

One or two lines each: what, and why. Newest last.

1. **Fastify, not Express.** Built-in JSON-schema/logging, `app.inject()` for fast in-process API tests, and it was already in place.
2. **`node:sqlite` (built into Node 22), not better-sqlite3.** No native compile step on the deploy host, so `npm ci` cannot fail on a missing toolchain. Needs Node ≥ 22.13; the experimental warning is silenced with `--disable-warning=ExperimentalWarning`.
3. **68 places, not 35.** The owner chose to keep the 68-place dataset from the earlier session; every count in tests and preflight uses 68.
4. **The browser renders places from the bundled dataset; the server seeds its DB from the same file (`src/data/places.ts`).** One source of truth, and the list still renders if the API or wifi dies mid-demo. `GET /api/places` exists for the assistant and API clients.
5. **In-app "add an API key" prompt and "AI is off" banner are development-only.** On stage the audience must never see "AI is off"; on a public URL anyone could set the first key. Production (`npm start`) hides them and `POST /api/ai/key` returns 404. Override with `AI_KEY_PROMPT=on`.
6. **Env var `DB_PATH`** (brief's name) replaces the earlier `DATABASE_PATH`.
7. **No hardcoded model.** `LLM_MODEL` is required whenever `LLM_API_KEY` is set; startup fails with a clear message otherwise. `.env.example` suggests `claude-haiku-4-5` (fast, inexpensive).
8. **Past dates:** new plans must be today or later in Seattle time; an edit cannot move a plan into the past. Existing past plans can still be viewed and deleted. The UI date inputs use the same `min`.
9. **Duplicates:** one plan per (user, place, date). A second one returns 409 and the UI says "already planned for that day". The old behaviour (silently overwriting the other date) was data loss.
10. **Assistant rate limit degrades instead of refusing.** Over the per-IP LLM budget, answers come from the cache or local matcher (`source` says which) instead of a 429, so the audience never sees a refusal. A hard ceiling (429 with a friendly message) protects the server from floods; the front end falls back locally on it.
11. **Places are upserted on every boot** (insert or update by id, never delete). This is idempotent, keeps foreign keys from plans intact, and picks up dataset edits.
