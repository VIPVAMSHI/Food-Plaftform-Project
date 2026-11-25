# Deploy to Vercel

The web app is served by Vercel's CDN, the API (`/api/*`) runs as one Vercel Function, and plans and favorites live in a Turso (libSQL) database. Places and the assistant's fallback need no database. Render (`render.yaml`, DEPLOY.md) still works as the fallback host.

You need: the GitHub repo, a Vercel account (Hobby is enough), a Turso account (free tier is enough), and optionally a Google Gemini API key.

Never paste a key or token into a file in the repo, a chat, or a `VITE_` variable. Each one goes only into Vercel's Environment Variables screen, or into a terminal prompt that hides it.

## 1. Push the branch

```bash
git push -u origin vercel-ready
```

## 2. Create the database (Turso), once

Install the CLI (macOS: `brew install tursodatabase/tap/turso`; others: https://docs.turso.tech/cli/installation) and run:

```bash
turso auth login
turso db create seattle-food
turso db show seattle-food --url        # → libsql://seattle-food-<org>.turso.io  (not a secret)
turso db tokens create seattle-food     # → a long token (SECRET: copy it, do not paste it anywhere else)
```

Create the tables from this repo. The token is typed into a hidden prompt, so it stays out of your shell history:

```bash
export DATABASE_URL=libsql://seattle-food-<org>.turso.io
read -rs DATABASE_AUTH_TOKEN && export DATABASE_AUTH_TOKEN    # paste the token, press Enter (nothing is shown)
npm run db:migrate
# → seattle-food-<org>.turso.io (remote): schema 0 → 1 (current 1)
unset DATABASE_AUTH_TOKEN
```

Running it again is safe ("already up to date"). Run it again after any release that adds a migration, **before** deploying that release.

## 3. Create the Vercel project

**Dashboard:** https://vercel.com/new → Import the GitHub repo → leave Root Directory as the repo root. `vercel.json` sets the rest (Vite, `npm ci`, `npm run build`, `dist`, the API function). Before clicking Deploy, open **Environment Variables** and add:

| Name | Value | Environments | Sensitive |
| --- | --- | --- | --- |
| `DATABASE_URL` | `libsql://seattle-food-<org>.turso.io` | Production, Preview | no |
| `DATABASE_AUTH_TOKEN` | the Turso token | Production, Preview | **yes** |
| `LLM_API_KEY` | Google key from https://aistudio.google.com/apikey (optional) | Production (and Preview if wanted) | **yes** |
| `LLM_MODEL` | `gemini-2.5-flash-lite` (required if the key is set) | same as the key | no |

Everything else is optional (`server/.env.example` lists every variable and whether it belongs on Vercel). Without `LLM_API_KEY` the assistant still answers from the bundled demo cache and the local matcher, with no visible error.

Then click **Deploy**.

**CLI alternative** (from the repo root):

```bash
npx vercel login
npx vercel link                                   # create or pick the project
npx vercel env add DATABASE_URL --environment production,preview --no-sensitive     # paste the URL when asked
npx vercel env add DATABASE_AUTH_TOKEN --environment production,preview --sensitive # paste the token when asked
npx vercel env add LLM_API_KEY --environment production --sensitive                # optional
npx vercel env add LLM_MODEL --environment production --no-sensitive               # if the key is set
npx vercel                                        # Preview deployment → prints its URL
npx vercel --prod                                 # Production
```

Environment variable changes apply to **new** deployments only. After editing one, redeploy (Deployments → ⋯ → Redeploy, or `npx vercel --prod`).

## 4. Deployment Protection (why "it works for me but not on other devices")

Vercel can put a login wall in front of deployments. When it does, anyone who isn't signed in to your Vercel team gets a Vercel login page instead of the app.

Settings → **Deployment Protection** → **Vercel Authentication**:

- **Standard Protection** (the default): Preview URLs and the generated `*-<hash>-<team>.vercel.app` deployment URLs require a Vercel login. The **production domain** (`<project>.vercel.app` and custom domains) is public. **Share the production domain.**
- To let others open Preview URLs too, set Vercel Authentication to **Disabled** (and Save). Do this only if previews should be public.
- Password Protection is a Pro feature. It isn't needed here.

`npm run preflight -- <url>` reports a login wall as RED with this hint.

## 5. Check it

```bash
npm run preflight -- https://<project>.vercel.app
```

Preflight passes when everything is GREEN, or YELLOW only for "LLM key configured" if you chose no key. It checks health, the app page, security headers, places, the demo queries, a private plan round trip under two throwaway browser ids, and stage settings.

Full browser suite against the deployment (mobile and desktop):

```bash
E2E_BASE_URL=https://<project>.vercel.app npx playwright test --project=mobile-390 --project=chromium-1440
```

Then open the URL on a phone: the restaurant list appears, a saved plan survives a reload, and a second phone does not see it.

## 6. Reset the demo data

This deletes every visitor's plans and favorites in the database the environment points at. A remote database needs the explicit flag:

```bash
export DATABASE_URL=libsql://seattle-food-<org>.turso.io
read -rs DATABASE_AUTH_TOKEN && export DATABASE_AUTH_TOKEN
npm run reset-demo -- --production
unset DATABASE_AUTH_TOKEN
```

## When something is wrong

Open `https://<project>.vercel.app/api/health`. It returns only booleans, never values:

| What you see | Meaning | Fix |
| --- | --- | --- |
| A Vercel login page | Deployment Protection | Use the production domain, or step 4 |
| `/api/health` is Vercel's 404 page | The API was not deployed | Make sure `api/index.ts` and `vercel.json` are on the deployed branch |
| `checks.databaseUrl: false` | `DATABASE_URL` missing, or a `file:` URL (not usable on Vercel) | Step 3, then redeploy |
| `checks.databaseReachable: false` | Wrong URL or token, or Turso is down | Recreate the token (`turso db tokens create`), update `DATABASE_AUTH_TOKEN`, redeploy |
| `checks.databaseSchema: false` | Tables not created | Step 2 (`npm run db:migrate`) |
| `configProblems: [...]` | Those variables have invalid values and were ignored | Fix them in Settings → Environment Variables, redeploy |
| `llmConfigured: false` with a key set | `LLM_MODEL` missing, or the key was rejected | Set `LLM_MODEL`; check the key in Google AI Studio |

The restaurant list and the assistant keep working while the database is down. Only saving plans and favorites shows a friendly "can't be reached right now" message.

Function logs are under Project → Logs. They never contain keys, tokens or chat messages.

## Limits worth knowing

- **Function timeout:** 15 s (`vercel.json`). The model gets 6 s, then the cache or the local matcher answers; the browser falls back locally at 9 s.
- **Per browser:** up to 50 plans, and 60 changes per minute (600 per network IP). Rate limits are counted per function instance, so they are approximate.
- **Plans belong to the browser, not a person.** Plans live under an anonymous id stored in that browser. Clearing site data or using another browser starts empty. There is no login.
