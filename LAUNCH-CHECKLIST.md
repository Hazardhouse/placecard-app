# PlaceCard Launch Checklist

Last updated: 2026-04-29

This is the master list of work that needs to land **before** flipping
placecard-events.app from a waitlist to live signups. It's the source of
truth — when something gets done, mark it done here, don't delete it
(useful for postmortems / for new contributors to see what was thought
through).

The list is grouped by category. Order within a category is roughly the
order to do things in.

---

## 1. Hosting & Infrastructure

- [ ] **Migrate from SQLite to Postgres.** `backend/placecard.db` and
      `event_planning.db` are local files — they get wiped on every
      deploy on most cloud hosts. Move to Supabase Postgres (already
      using Supabase for auth, so one vendor for both).
- [ ] **Replace `Base.metadata.create_all` with Alembic migrations.**
      The current ad-hoc `ALTER TABLE` block at the top of `main.py`
      works for solo dev but is risky in prod. Set up Alembic, capture
      current schema as the baseline, run real migrations from there.
- [ ] **Stand up Render Web Service** for the FastAPI backend.
      Free tier is fine for waitlist phase; upgrade to Standard ($25/mo)
      when traffic goes public — Free has a 15-min idle spin-down and
      ~30s cold start that real users will hit.
- [ ] **Stand up Cloudflare Pages** for the frontend (Vite SPA build).
      Free tier is genuinely sufficient.
- [ ] **DNS routing**: `app.placecard-events.app` → Cloudflare Pages
      (frontend), with `/api/*` reverse-proxied to Render (or set
      `VITE_API_BASE` to a separate `api.placecard-events.app`
      subdomain).
- [ ] **Production env vars** — set on Render and Cloudflare Pages:
      - `FRONTEND_URL` (used in restaurant share links etc.)
      - `DATABASE_URL` (Supabase Postgres connection string)
      - `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`,
        `SUPABASE_JWT_SECRET`
      - `GEMINI_API_KEY` (Nano Banana for design generation)
      - `RESEND_API_KEY` (transactional email)
      - `GOOGLE_PLACES_API_KEY` (location/venue autocomplete) — *not
        wired yet, see §3*
      - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
        `TWILIO_PHONE_NUMBER`, `TWILIO_WHATSAPP_NUMBER` — see §4
      - 4over print fulfillment creds
- [x] **CORS** — driven by `ALLOWED_ORIGINS` env var. Set to the
      production frontend domain(s) at deploy time. *(Done 2026-05-11.)*
- [ ] **Run `SOP-SECURITY-RUNBOOK.md` §1 — Secret Hardening — before
      first production deploy.** Rotates every secret currently in
      local `.env` files (Supabase service key, JWT secret, Gemini,
      etc.) plus sets spend caps, scope restrictions, 2FA. **Required
      pre-deploy**.
- [ ] **Run `SOP-SECURITY-RUNBOOK.md` §2 — User Data Protection Audit
      — before any non-operator account is granted access.** Verifies
      JWT middleware, RLS, rate limiting, GDPR endpoints in place.
- [ ] **Run `SOP-SECURITY-RUNBOOK.md` §3 — Final Pass — before
      marketing site flips off the waitlist.** Backups verified,
      monitoring active, incident response documented, git history
      scanned for accidental secret commits.
- [ ] **Pin Python version**. Local dev currently runs Python 3.9
      from CommandLineTools. We've already been bitten twice by 3.9
      quirks (PEP 604 `int | None` syntax, pdfplumber not installed).
      Standardise on 3.11 or 3.12 — add a `.python-version` file +
      pin in `pyproject.toml`, set the same on Render.

### Upgrade triggers (deferred until after waitlist drops)

- [ ] **Supabase Free → Pro ($25/mo)**. Trigger: the day real customer
      data hits the DB. Pro gets daily backups, point-in-time recovery,
      removes the 7-day-inactive auto-pause. Free is fine until then.
- [ ] **Render Free → Standard ($25/mo)**. Same trigger — kills cold
      starts, gives 2GB RAM.

---

## 2. Database & Storage

- [ ] **Image storage migration** (Phase 2, *not* launch-blocking).
      Currently event hero images, attendee photos, and form-collected
      images live as base64 data URLs in the DB. Each compressed image
      is ~70–100 KB. The 500 MB Supabase Free ceiling sneaks up faster
      than expected once people start uploading. Move to Supabase
      Storage (file system) with public-read URLs in the DB instead.
- [ ] **Backup verification**. Once on Supabase Pro, do a test restore
      of a backup *before* you need it. "We have backups" without ever
      restoring is a known liar.

---

## 3. Third-party APIs

- [ ] **Google Places API key**. Backend `places.py` router exists but
      no key is wired. Frontend autocomplete (event location, schedule
      venue) is dead until this is set up. Costs are per-request — set
      a billing alert.
- [ ] **Resend domain verification** for `placecard-events.app` — DNS
      records (SPF, DKIM, DMARC). Mails will go to spam without these.
- [ ] **Gemini key on a project with billing enabled.** Free tier is
      heavily rate-limited; design generation fans out to 6 parallel
      calls, will hit limits fast.

---

## 4. Twilio / SMS / WhatsApp

The whole messaging layer is "Model A: platform-managed" — one Twilio
account owned by PlaceCard, one sender number, customers just toggle
channels on/off in Settings. See `backend/app/services/notifications.py`.

### Required before turning SMS on for real users

- [ ] **A2P 10DLC registration.** US carriers filter unregistered
      brand-to-consumer SMS. Register the brand (~$15) + at least one
      campaign (~$10/month) via Twilio. *Days of lead time* — start
      this early.
- [ ] **Twilio Sender ID display name** set to "PlaceCard" where
      supported, so recipients see the brand instead of a raw phone
      number.
- [ ] **Inbound webhook for STOP/HELP** — Twilio compliance requires
      auto-replies to STOP / HELP keywords. Add a `/api/twilio/inbound`
      endpoint, register it as the messaging webhook in the Twilio
      console.
- [ ] **Inbound reply logging** — even if guests can't currently
      reply-to-organizer, we should at least log inbound messages so
      Dani can see them and follow up manually. Surface in admin UI
      later.
- [ ] **Per-event sender configurability** (Phase 2). Single global
      sender number is fine for v1; later, allow Enterprise customers
      to BYO Twilio (their own SID/token/number, configured in their
      Settings tab).

### Required before turning WhatsApp on

- [ ] **Meta Business verification** (FB Business Manager + business
      docs) — required for WhatsApp Business API. Slow process.
- [ ] **WhatsApp template approval.** Any WA message *not* in response
      to a customer-initiated message must use a Meta-approved
      template per language/region. Reminders are business-initiated,
      so they need templates. Current `_build_message()` output won't
      pass review without restructuring into a template form.
- [ ] **Recommendation: defer WhatsApp until launch +1.** Gating launch
      on Meta's verification cycle is too risky. Ship SMS first.

### Plan limits (already done 2026-04-29)

- [x] PLAN_LIMITS in `routers/settings.py` and `services/notifications.py`
      now match the website: Free 0 / Socialite 500 / Event Planner 2000
      / Enterprise unlimited.

---

## 5. Billing

- [ ] **Decision parked**: stay on waitlist for launch, no Stripe yet.
      Marketing site CTAs all go to "Join the Waitlist".
- [ ] **Wire up Stripe (or Paddle / Lemon Squeezy as MoR)** — when
      ready to drop the waitlist gate. Recommendation was MoR
      (Paddle/LS) over raw Stripe to absorb global VAT/sales-tax
      compliance. ~5% all-in vs. Stripe's ~2.9% but worth it without a
      finance hire.
- [ ] **Wise Business** — for receiving Enterprise wires (cheaper
      forex than Stripe) and paying out to suppliers (4over,
      contractors). Not the customer billing platform.
- [ ] **Surface plan in `/api/settings/usage`**: currently hardcoded
      to `"Socialite"` — replace with a real per-user plan lookup once
      the billing table exists.

---

## 6. Frontend / UX cleanup

These were flagged inline during dev — none are blockers, but each is
worth ticking off so we don't ship rough edges.

- [ ] **Mobile event sidebar**: the image-upload button and the
      Event-Link button get hidden on mobile (they don't fit on the
      88×88 thumbnail). Image upload is also not surfaced anywhere
      else. Add an image upload field to the EventDrawer so mobile
      users can replace the photo from the edit drawer.
- [ ] **Brand panel** — the "+" button + URL color extraction was
      stripped for launch. State is preserved in props for Phase II.
      Source in git history.
- [ ] **`AttendeeList` unused-search fallback**: now that `EventDetail`
      always passes `filter` as a prop, the internal search fallback
      in `AttendeeList` is mostly dead. Remove or keep for reuse?
- [ ] **Pre-existing TS errors** in `EventDetail.tsx` and
      `CollateralTab.tsx` (unused decls, JSX namespace, DrawShape
      type). Clean these up before turning on strict CI.
- [ ] **Old `.back-link` CSS** is unused after we replaced it with
      `.back-to-events-btn`. Sweep.
- [ ] **Attendee count** got removed when the "Attendees" h2 came out.
      No place inside the event view shows the live count anymore. Add
      a small `count-chip` somewhere (next to the search?) if useful.
- [ ] **Loading / error states** audit. Most pages assume happy path —
      check what happens on 401 (expired token), 500 (backend down),
      slow network. Especially the AI generation + PDF parse paths.
- [ ] **Scope the global `input, select, textarea` CSS rule**. Currently
      every `<input>` — including `[type="radio"]` and `[type="checkbox"]`
      — gets `width: 100%; padding: 8px 12px; border: 1px solid; ...`,
      which broke the print-set popup's radios on first render. We patched
      that one site, but there are likely other places that look fine
      only because the radio/checkbox is `display: none` and replaced.
      Tighten the global selector to text-like input types only.
- [ ] **Per-arrangement tables refactor** (deferred from 2026-04-29
      conversation). Currently `tables` are event-scoped, so editing a
      table in one meal's arrangement affects all meals; orphan tables
      accumulate when arrangements are deleted/recreated; share-link
      bug just patched (commit on this date) was a downstream symptom.
      Full fix: add `arrangement_id` to `tables`, migrate existing
      data, scope all CRUD by arrangement, auto-clone-on-create. ~4-6
      hours.
- [ ] **Orphan-table cleanup** for any test events carried into prod.
      Pre-launch sweep — `DELETE FROM tables WHERE id NOT IN (SELECT
      DISTINCT table_id FROM seat_assignments)`. Eyeball the
      candidate list first.
- [ ] **Mobile audit** — explicitly walk every page on a real phone.
      We've fixed mobile bugs as they came up but haven't done a
      systematic pass.

---

## 7. Marketing site (placecard-events.app)

- [ ] **Drop the waitlist gate** on plan CTAs. They currently all go
      to "Join the Waitlist" — switch to "Sign up" / "Start free" once
      we're ready to take real signups.
- [ ] **Update plan copy** to match the in-app reality. Plan limits
      and feature bullets need to be the same source of truth in both
      places (probably a shared JSON or CMS).
- [ ] **`Log In` link** is currently disabled (`header-login-disabled`
      class). Re-enable + point at `app.placecard-events.app/login`.

---

## 8. Compliance & legal

- [ ] **Terms of Service** and **Privacy Policy** drafted, hosted, and
      linked from the marketing site footer + the app sign-up flow.
- [ ] **Cookie consent / data processing** disclosures, especially for
      EU traffic. Supabase + Vercel/Cloudflare are processors — list
      them in the privacy policy.
- [ ] **GDPR data export & deletion** endpoints. Even one EU user
      makes this required. Supabase Auth exposes user delete; we'd
      cascade delete owned events/attendees.
- [ ] **Email-marketing consent tracking** (CAN-SPAM, GDPR). If
      reminders go out via Resend, distinguish transactional from
      marketing — different consent rules.

---

## 9. Operational / monitoring

- [ ] **Error reporting**: Sentry or equivalent on both frontend and
      backend. Currently errors fall on the floor.
- [ ] **Uptime monitoring**: a basic ping on `/api/events` so we know
      when the backend is down. UptimeRobot free tier is fine.
- [ ] **Cron keep-alive** for Supabase Free if we stay on it past the
      waitlist phase — a once-a-day ping prevents the 7-day auto-pause.
- [ ] **Logs**: Render keeps logs for 7 days on free, longer on
      paid. Decide if we need long-term log storage (Logtail, Axiom,
      etc.) — probably not until customer support volume justifies it.
- [ ] **A first-pass runbook** for the 5 most-likely incidents: backend
      down, DB full, Twilio failing, Gemini rate-limited, Stripe
      webhook stuck. What does Dani do at 11pm.

---

## 10. Pre-flight (the day before launch)

- [ ] Run a full event creation → attendee invite → seating →
      restaurant share → name card generation flow end-to-end on the
      production stack.
- [ ] Send a real SMS reminder to a real phone, from the production
      Twilio number, with 10DLC registered.
- [ ] Verify backups are running on Supabase.
- [ ] Verify error alerts route to Dani's inbox (cause an error on
      purpose, confirm the alert).
- [ ] Soft-launch announcement drafted but not sent. Final review.

---

## How to use this file

When working on any item, mark it `[~]` in progress with a note;
mark `[x]` when done with the date. Don't delete completed items —
keep them for future reference.

If a new launch-blocker is discovered mid-development, add it here
*and* mention it in the conversation, so it's captured in two places.
