# Seattle Food Discovery

Pick where to eat in Seattle by budget, neighborhood, and time, ask a food assistant, and save dining plans and favorites.
Locally, one Node service (Fastify) serves the React app and the API, with plans and favorites in a SQLite file. On Vercel the API runs as one function and the data lives in Turso (libSQL). The 68 places ship with the code. The assistant uses Google Gemini when a key is set, and falls back to a cache and a local matcher otherwise.

Each browser gets an anonymous id, so plans and favorites are private to that browser. There is no login.

## Run

Needs Node 22.13+.

```bash
npm ci                 # installs the app and server/ packages
npm run build
npm start              # http://localhost:3001 (creates server/data/bite.db on first run; works offline)
```

Development (hot reload, API proxied): `npm run dev` → http://localhost:5173

Optional AI: copy `server/.env.example` to `server/.env` and set `LLM_API_KEY` and `LLM_MODEL`. Without them everything still works.

## Deploy

- Vercel: [VERCEL_DEPLOY.md](VERCEL_DEPLOY.md)
- Render (fallback): [DEPLOY.md](DEPLOY.md)

## Commands

| Command | What it does |
| --- | --- |
| `npm test` | Unit + API tests (Vitest) |
| `npm run test:e2e` | Browser tests (Playwright: Chrome 1440/1920, mobile 390, Safari) incl. accessibility. `E2E_BASE_URL=<url>` runs them against a deployment |
| `npm run test:eval` | 50-query assistant eval (local always; live model 3× if a key is set) |
| `npm run test:chaos` / `test:security` / `test:lighthouse` | Crash, config, load; secrets, logs, audit; Lighthouse (needs a running server) |
| `npm run test:all` | Lint, build, secret scan, and all of the above except Lighthouse |
| `npm run preflight -- <url>` | Backstage check: GREEN / YELLOW / RED |
| `npm run db:migrate` | Create or update the tables in the database `DATABASE_URL` points at (the local server does this itself) |
| `npm run reset-demo` | Remove all plans and favorites (every browser). Remote databases need `-- --production` |
| `npm run cache:build` | Regenerate the bundled assistant demo cache (live answers if a key is set) |

## Demo docs

[DEMO_SCRIPT.md](DEMO_SCRIPT.md) · [BACKUP_PLAN.md](BACKUP_PLAN.md) · [TALKING_POINTS.md](TALKING_POINTS.md) · [DEPLOY.md](DEPLOY.md) · [VERCEL_DEPLOY.md](VERCEL_DEPLOY.md) · [FINAL_REPORT.md](FINAL_REPORT.md)

Ratings and waits are sample data, travel times are estimates, photos are cuisine stand-ins, and plans do not reserve a table.
