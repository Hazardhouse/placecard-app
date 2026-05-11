# PlaceCard — Deployment & Security SOP

Pre-launch checklist before deploying to Vercel and going live.

---

## 1. Security — Attendee Data Protection

### 1.1 Backend Auth Middleware (Priority: Critical)
- [ ] Add JWT validation dependency to all FastAPI routes
- [ ] Create `backend/app/auth.py` — verify Supabase JWT, extract user ID
- [ ] Scope all database queries to the authenticated user
- [ ] Reject requests with missing/expired/invalid tokens

### 1.2 Row-Level Security in Supabase (Priority: Critical)
- [ ] Enable RLS on all tables (events, attendees, schedule_items, etc.)
- [ ] Create policies: users can only SELECT/INSERT/UPDATE/DELETE their own data
- [ ] Test that one user cannot access another user's events or attendees

### 1.3 HTTPS
- [ ] Vercel handles frontend HTTPS automatically
- [ ] Ensure backend API is behind HTTPS (not plain HTTP)
- [ ] No mixed content warnings

### 1.4 Rate Limiting (Priority: High)
- [ ] Add rate limiting middleware to FastAPI (e.g., slowapi)
- [ ] Login endpoint: max 5 attempts per minute per IP
- [ ] API endpoints: max 100 requests per minute per user
- [ ] Invite endpoint: max 10 invites per hour

### 1.5 Input Sanitization
- [ ] SQLAlchemy parameterized queries (already in place)
- [ ] Sanitize user-generated content rendered in frontend (XSS prevention)
- [ ] Validate email formats, phone numbers on backend

### 1.6 Sensitive Data
- [ ] Encrypt phone numbers and emails at rest (attendee PII)
- [ ] Never log sensitive data (passwords, tokens, phone numbers)
- [ ] Environment variables for all secrets (never hardcoded)

### 1.7 GDPR / Privacy
- [ ] Privacy policy page on marketing site
- [ ] Data export functionality (user can download their data)
- [ ] Data deletion functionality (user can delete their account + all data)
- [ ] Cookie consent banner if analytics are added

---

## 2. Security — Protecting the Product

### 2.1 CORS Restrictions
- [ ] Lock CORS to only allow `placecard.com`, `app.placecard.com`, and `localhost` (dev)
- [ ] Remove wildcard (`*`) CORS in production

### 2.2 Anti-Scraping
- [ ] `robots.txt` on `app.placecard.com` blocking all crawlers
- [ ] All data endpoints require authentication (no public APIs)
- [ ] Rate limiting (covered above)

### 2.3 Code Protection
- [ ] Vite production build with minification enabled (default)
- [ ] Business logic lives on backend, not frontend
- [ ] Source maps disabled in production build

---

## 3. Deployment — Vercel Setup

### 3.1 Frontend (app.placecard.com)
- [ ] Connect GitHub repo to Vercel
- [ ] Set build command: `cd 01_Projects/PlaceCard/frontend && npm run build`
- [ ] Set output directory: `01_Projects/PlaceCard/frontend/dist`
- [ ] Add environment variables:
  - `VITE_SUPABASE_URL`
  - `VITE_SUPABASE_ANON_KEY`
  - `VITE_API_URL` (backend URL)

### 3.2 Marketing Site (placecard.com)
- [ ] Separate Vercel project from `website` folder
- [ ] Connect to same GitHub repo or separate

### 3.3 Backend API — Render (Starter Plan, $7/mo)
- [ ] Create a Render account at render.com
- [ ] Create a new **Web Service** → connect GitHub repo
- [ ] Set root directory: `01_Projects/PlaceCard/backend`
- [ ] Set build command: `pip install -r requirements.txt`
- [ ] Set start command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- [ ] Select **Starter plan ($7/mo)** — always-on, no cold starts, 512MB RAM
- [ ] Set environment variables:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_KEY`
  - `SUPABASE_JWT_SECRET`
  - `TWILIO_ACCOUNT_SID`
  - `TWILIO_AUTH_TOKEN`
  - `TWILIO_PHONE_NUMBER`
  - `TWILIO_WHATSAPP_NUMBER`
  - `GOOGLE_PLACES_API_KEY`
  - `DATABASE_URL` (Supabase PostgreSQL connection string)
- [ ] Migrate from SQLite to PostgreSQL (use Supabase's free Postgres DB)
- [ ] Update `backend/app/database.py` to use `DATABASE_URL` env var
- [ ] Test all API endpoints respond from Render URL

### 3.4 Domain Configuration
- [ ] Add `app.placecard-events.app` CNAME → `cname.vercel-dns.com` (app)
- [ ] Root domain `placecard-events.app` A record → `76.76.21.21` (marketing site)
- [ ] Add custom domain on Render for API (e.g., `api.placecard-events.app`)
- [ ] SSL certificates auto-provisioned by Vercel and Render

### 3.5 Supabase URL Configuration
- [ ] Site URL → `https://app.placecard-events.app`
- [ ] Redirect URLs → `https://app.placecard-events.app`
- [ ] Remove localhost URLs from production

---

## 4. Plan Limits & Stripe Integration

### 4.1 Supabase Subscriptions Table
- [ ] Create `subscriptions` table: `user_id`, `plan` (free/pro/business), `stripe_customer_id`, `stripe_subscription_id`, `status` (active/canceled/past_due), `current_period_end`
- [ ] Default new users to "free" plan

### 4.2 Plan Limits (Backend Enforcement)
- [ ] Create `backend/app/plans.py` with limits per plan:
  - **Free**: X events, Y attendees/event, 1 team member, Z SMS/WhatsApp
  - **Pro**: higher limits
  - **Business**: unlimited or very high limits
- [ ] Add `check_plan_limit()` dependency to create endpoints (events, attendees, team members)
- [ ] Return 403 with upgrade message when limits exceeded
- [ ] Frontend reads plan limits and shows usage / gates features

### 4.3 Stripe Integration
- [ ] Create Stripe account and products/prices for each plan
- [ ] Marketing site (`placecard-events.app`): Stripe Checkout session for signup
- [ ] Backend webhook endpoint: `POST /api/webhooks/stripe`
  - Handle `checkout.session.completed` → create subscription record
  - Handle `customer.subscription.updated` → update plan
  - Handle `customer.subscription.deleted` → downgrade to free
- [ ] Verify Stripe webhook signatures for security
- [ ] Add Stripe customer portal link for users to manage billing

---

## 5. Pre-Launch Testing

- [ ] Login / signup / logout flow works on live domain
- [ ] Invite email links redirect to `app.placecard-events.app` and work
- [ ] Password reset flow works
- [ ] All API calls hit the production backend (Render)
- [ ] Events, attendees, schedule, seating all CRUD correctly
- [ ] Notifications (SMS/WhatsApp) send successfully
- [ ] One user cannot see another user's data
- [ ] Plan limits enforced correctly (free user can't exceed limits)
- [ ] Stripe checkout creates subscription and unlocks features
- [ ] Stripe webhook updates plan on upgrade/downgrade/cancel
- [ ] Mobile responsive check
- [ ] Browser testing (Chrome, Safari, Firefox)

---

## 6. Monthly Costs Summary

| Service | Cost | Notes |
|---|---|---|
| Vercel (frontend) | Free | Generous free tier for static sites |
| Render (backend) | $7/mo | Starter plan, always-on |
| Supabase (auth + DB) | Free | Free tier: 500MB DB, 50K auth users |
| Stripe | 2.9% + 30¢ per txn | No monthly fee, pay per transaction |
| Twilio (SMS) | ~$0.0079/msg | Pay as you go |
| Twilio (WhatsApp) | ~$0.005/msg | Pay as you go |
| Google Places API | $0 – $200/mo free | $200 free credit/month from Google |
| **Total fixed cost** | **~$7/mo** | Before Twilio usage |
