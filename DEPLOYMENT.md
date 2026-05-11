# PlaceCard Deployment Reference

Operational notes for deploying the app to Render (backend) and Cloudflare
Pages (frontend). Pairs with `SOP-DEPLOYMENT-SECURITY.md` (the policy) and
`LAUNCH-CHECKLIST.md` (the task list).

---

## Hosts at a glance

| Surface | Host | Build root | Cost |
|---|---|---|---|
| Marketing site (`placecard-events.app`) | Cloudflare Pages | `website/` (separate repo) | Free |
| App frontend (`app.placecard-events.app`) | Cloudflare Pages | `frontend/` | Free |
| Backend API (`api.placecard-events.app`) | Render Starter | `backend/` | **$7/mo** |
| Database + Auth | Supabase (Free → Pro on launch) | n/a | $0–25/mo |

---

## Backend — Render Web Service (Starter)

### Service settings

- **Plan**: Starter ($7/mo, always-on, 512 MB RAM)
- **Root Directory**: `backend`
- **Runtime**: Python 3
- **Build Command**: `pip install -r requirements.txt`
- **Start Command**: `alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT`
  - The `alembic upgrade head` runs migrations before serving, so schema
    changes ship with the app instead of being a manual step.
- **Auto-Deploy**: enabled, branch `main`
- **Health Check Path**: `/api/events` (returns 200 with empty array or
  data; cheap probe).
- **Python Version**: 3.11 (enforce via `.python-version` in `backend/`)

### Required environment variables

| Key | Value | Source |
|---|---|---|
| `DATABASE_URL` | Supabase Postgres connection string (Direct connection, port 5432) | Supabase dashboard → Database → Connection string |
| `ALLOWED_ORIGINS` | `https://app.placecard-events.app` | Set to comma-separated list when adding more origins |
| `SUPABASE_URL` | `https://xxwbdxjwqkkrniqrmlej.supabase.co` | from current `.env` |
| `SUPABASE_SERVICE_KEY` | (rotate before sharing repo access) | Supabase dashboard → Settings → API |
| `SUPABASE_JWT_SECRET` | Supabase JWT secret | Supabase dashboard → Settings → API → JWT Secret |
| `SECRET_KEY` | A random 64+ char string (different from dev) | `python -c "import secrets; print(secrets.token_urlsafe(64))"` |
| `FRONTEND_URL` | `https://app.placecard-events.app` | |
| `GEMINI_API_KEY` | (rotate before sharing repo access) | Google AI Studio |
| `GOOGLE_PLACES_API_KEY` | (set up before launch) | Google Cloud Console |
| `RESEND_API_KEY` | (set up before launch) | resend.com |
| `RESEND_FROM_EMAIL` | `events@placecard-events.app` | After DNS verification |
| `TWILIO_ACCOUNT_SID` | (after A2P 10DLC registration) | twilio.com |
| `TWILIO_AUTH_TOKEN` | (after A2P 10DLC registration) | twilio.com |
| `TWILIO_PHONE_NUMBER` | (after A2P 10DLC registration) | twilio.com |
| `TWILIO_WHATSAPP_NUMBER` | (defer to launch +1 per checklist §4) | |
| `FOUROVER_API_KEY` | (when ready to flip print orders out of mock mode) | 4over.com |
| `FOUROVER_PRIVATE_KEY` | | 4over.com |
| `FOUROVER_MODE` | `sandbox` (then `production`) | |

### Custom domain

Add `api.placecard-events.app` in Render → Settings → Custom Domains.
Render provisions the SSL cert automatically. Then in DNS:

```
api.placecard-events.app   CNAME   <render-provided-cname>
```

---

## Frontend — Cloudflare Pages

### Project settings

- **Production branch**: `main`
- **Framework preset**: Vite
- **Build command**: `cd frontend && npm install && npm run build`
- **Build output directory**: `frontend/dist`
- **Root directory**: leave blank (CF Pages runs the build command from
  the repo root; the `cd frontend` handles the subdirectory)
- **Node version**: 20 (set via `NODE_VERSION` env var)

### Required environment variables

| Key | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://xxwbdxjwqkkrniqrmlej.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | (anon key from Supabase dashboard) |
| `VITE_API_URL` | `https://api.placecard-events.app/api` |
| `NODE_VERSION` | `20` |

Note `VITE_API_URL` replaces the hardcoded `http://localhost:8000/api` in
`frontend/src/api/client.ts` — that needs a small edit before the first
deploy (covered separately).

### Custom domain

Add `app.placecard-events.app` in Cloudflare Pages → Custom domains.
Auto-provisioned SSL.

---

## Database — Supabase Postgres

### Provisioning

The existing Supabase project already hosts Auth; the same project's
Postgres instance is the production DB.

- **Connection mode**: Direct connection (not pooler) for Alembic
  migrations. Pooler is fine for the FastAPI runtime but Alembic needs
  a direct session for DDL.
- **Connection string format**: `postgresql://postgres:<password>@<host>:5432/postgres`
  — `database.py` auto-rewrites this to `postgresql+psycopg://...` so
  no manual prefix needed.

### First migration

Run from a local machine pointed at the Supabase Postgres:

```
cd backend
export DATABASE_URL="postgresql://postgres:..."  # from Supabase
python3.11 -m alembic upgrade head
```

This applies `2026_05_11_..._baseline_schema.py` and creates every
table from the model metadata. Render then takes over for subsequent
migrations on each deploy.

### Data migration from SQLite

The local SQLite `event_planning.db` has live test data. Options:

1. **Fresh start**: skip the export, let Postgres start empty. Best
   for the alpha — your existing test events were development noise.
2. **Bulk export/import**: dump SQLite → CSV per table → `\copy` into
   Postgres. Doable but requires care with FK ordering and JSON columns
   (`meal_options`, `image_data`).

Recommendation: start fresh on Postgres. Reseed any reference data
needed.

---

## DNS records summary

Assuming Cloudflare manages `placecard-events.app` DNS:

```
placecard-events.app           CNAME   <CF Pages hostname for marketing>
app.placecard-events.app       CNAME   <CF Pages hostname for app>
api.placecard-events.app       CNAME   <Render hostname>
```

CF will manage SSL for the first two automatically (they're on CF).
Render manages SSL for the third.

---

## Pre-deploy code edits

A small set of edits is required before the first deploy. None of these
are launch-blockers but the deploy won't be functional without them:

1. **`frontend/src/api/client.ts`** — replace the hardcoded
   `http://localhost:8000/api` with `import.meta.env.VITE_API_URL` so
   the production frontend talks to the production API.
2. **`frontend/src/lib/supabase.ts`** — confirm it already reads
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from env (it does).
3. **Backend auth middleware** — see SOP §1.1. Not deploy-blocking but
   required before letting anyone other than the operator log in.
4. **Remove the on-startup `ALTER TABLE` block in `app/main.py`** —
   Alembic now owns schema. Leave temporarily for safety on existing
   SQLite DBs, remove once we're confident Postgres has applied the
   baseline.

---

## Secret rotation before going public

Every key currently in `backend/.env` and `frontend/.env` is checked
into shell history and was visible during dev. Before the marketing site
flips off the waitlist, rotate:

- Supabase service key
- Supabase JWT secret
- Gemini API key
- Twilio auth token
- 4over private key (when wired)
- `SECRET_KEY`

Then update Render's env vars with the new values.
