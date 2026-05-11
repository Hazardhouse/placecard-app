# PlaceCard — Security Runbook

Operational steps to harden secrets and protect user data. This is the
*runbook* — what to execute and when. The architectural side
(JWT middleware, RLS policies, rate limiting) lives in
`SOP-DEPLOYMENT-SECURITY.md`; the broader pre-launch tracker is
`LAUNCH-CHECKLIST.md`.

Run **§1 (Secret Hardening)** the day before first production deploy.
Run **§2 (User Data Protection Audit)** before letting anyone other
than the operator access the live app.
Run **§3 (Pre-public-launch Final Pass)** before the marketing site
drops the waitlist gate.

---

## §1 — Secret Hardening (run before first production deploy)

Every secret currently in `backend/.env` and `frontend/.env` was visible
during development (shell history, conversation logs, screenshots). Treat
them all as compromised. Rotate, store properly, restrict scope, alert
on usage.

### 1.1 Rotate every secret

For each item below: revoke the existing key, generate a new one,
update Bitwarden, paste into Render / Cloudflare Pages env vars. Do
**not** put the new keys in any `.env` file that exists on a developer
machine.

| Secret | Where to rotate | Notes |
|---|---|---|
| Supabase Service Role Key | Supabase → Settings → API → "Generate new service_role secret" | Backend only. Never exposed to frontend. |
| Supabase JWT Secret | Supabase → Settings → API → "Generate new JWT secret" | Invalidates all existing sessions — users will need to log in again. |
| Supabase anon key | Auto-rotates when JWT secret rotates | Goes into frontend env vars |
| Gemini API key | Google AI Studio → API keys → revoke + create new | Restrict the new key to Generative Language API only |
| `SECRET_KEY` (FastAPI) | Generate with: `python3.11 -c "import secrets; print(secrets.token_urlsafe(64))"` | Currently `dev-secret-key-change-in-production` — laughably weak |
| Google Places API key | Google Cloud Console → APIs & Services → Credentials | Restrict to Places API only + HTTP referrer (`*.placecard-events.app`) |
| Resend API key | Resend dashboard → API Keys | After DNS verification of sending domain |
| Twilio Auth Token | Twilio Console → Account → API keys & tokens | Only after A2P 10DLC registration completes |
| 4over private key | 4over partner dashboard | Only when flipping out of sandbox mode |

After every rotation, run the verification step in §1.7.

### 1.2 Set spend caps + usage alerts

A leaked key with no spend cap can rack up thousands of dollars overnight.

| Service | Cap / Alert |
|---|---|
| Gemini (Google Cloud) | Billing → Budgets & alerts → $50 / $100 / $200 thresholds. Notify on 50%, 90%, 100% of budget. |
| Twilio | Console → Billing → Spending Limits. Set a hard monthly cap (start at $50). |
| Render | Account → Billing → Spend alerts at $50/mo (services are flat $7 but flag unexpected) |
| Supabase | Project → Billing → Spend cap when on Pro |
| 4over | Account-level credit limit (manual, contact account rep) |

### 1.3 Restrict key scope

A key that can do less is a key that hurts less when leaked.

- **Gemini**: Google Cloud Console → Credentials → restrict the key to "Generative Language API" only. Also restrict by application: "HTTP referrers" won't work for backend keys, but you can set "IP addresses" to Render's egress range (look up Render's static outbound IP list).
- **Google Places API**: same Google Cloud Console UI. Restrict to "Places API" + HTTP referrer `https://app.placecard-events.app/*` for the frontend-facing autocomplete (if that pattern is used; otherwise IP-restrict to Render).
- **Supabase service key**: not restrictable — it's a master key. Mitigation: only ever use it server-side. Never put it in any frontend code or env var.
- **Twilio**: Twilio supports API key (separate from auth token) with scoped permissions. Use an API key restricted to "Messaging Service" actions only, not full account access.

### 1.4 Enable 2FA on every infra account

Single biggest lift for account security. Use a TOTP authenticator
(1Password, Bitwarden, Authy) — not SMS, which is vulnerable to SIM
swap attacks.

- [ ] GitHub (where the code lives)
- [ ] Render (where the backend runs)
- [ ] Cloudflare (DNS + frontend hosting + marketing)
- [ ] Supabase (auth + DB)
- [ ] Google Cloud (Gemini + Places billing)
- [ ] Resend (email)
- [ ] Twilio (SMS + WhatsApp when wired)
- [ ] 4over (print orders when wired)
- [ ] Stripe / Paddle (when billing is wired)
- [ ] Apple ID / iCloud (the laptop's recovery + Keychain)

### 1.5 Where secrets live in production

| Location | Encrypted at rest? | Who can read |
|---|---|---|
| Render env vars | Yes | Running service + dashboard logged-in user |
| Cloudflare Pages env vars | Yes | Build/runtime + dashboard logged-in user |
| Supabase project dashboard | Yes | Dashboard logged-in user |
| Bitwarden vault (your copy) | Yes (E2E encrypted) | You (master password + 2FA) |

**Never** in:
- Git repository
- `.env` files on production servers
- Shell history (use `set +o history` for sensitive commands)
- Slack, email, Notion, screenshots
- The frontend bundle (any `VITE_*` env var is shipped to users — only put public values there, like Supabase URL and anon key)

### 1.6 Local hygiene

- [ ] Delete `backend/.env.bak` (stale backup, contains old credentials)
- [ ] Enable FileVault on macOS (System Settings → Privacy & Security → FileVault). Encrypts disk; stolen laptop becomes useless without password.
- [ ] Audit shell history for accidental secret exposure: `grep -iE "supabase|gemini|twilio|API_KEY" ~/.zsh_history`
- [ ] Add the verify step (§1.7) to your laptop's `~/.gitignore_global` if you want belt-and-braces:
  - `git config --global core.excludesfile ~/.gitignore_global`
  - Add `.env*` to `~/.gitignore_global`

### 1.7 Verify rotation worked

After rotating each secret, prove the old key is dead:

- **Supabase service key**: try a curl with the old key — should get 401:
  ```
  curl -H "apikey: OLD_KEY" https://xxwbdxjwqkkrniqrmlej.supabase.co/rest/v1/events
  ```
- **Supabase JWT secret**: any session token issued before the rotation should now fail. Logging out + back in with a freshly-issued token should work.
- **Gemini key**: same pattern — old key in a test API call should get a 403.

If the old key still works → rotation didn't actually take effect, do it again.

---

## §2 — User Data Protection Audit (run before any non-operator user accesses live app)

Layered defence — multiple independent layers, no single failure exposes data.

### 2.1 Verify each layer is in place

| Layer | Mechanism | How to verify |
|---|---|---|
| Transport encryption | HTTPS everywhere | Visit `https://app.placecard-events.app` — lock icon, valid cert |
| CORS allow-list | `ALLOWED_ORIGINS` env var, no wildcard | `curl -i -H "Origin: https://evil.com" https://api.placecard-events.app/api/events` should not return permissive CORS headers |
| Backend JWT middleware | Every API route rejects missing/invalid tokens | `curl https://api.placecard-events.app/api/events` (no auth) → 401. Implemented per SOP-DEPLOYMENT-SECURITY §1.1 |
| Row-Level Security (RLS) | Postgres-enforced per-user isolation | Create two test users; user A creates event; user B's API call with their token cannot see user A's event. Implemented per SOP §1.2 |
| DB encryption at rest | AES-256 on Supabase Postgres | Supabase docs confirm; nothing to configure |
| Input validation | Pydantic schemas on all endpoints | Send malformed JSON → 422 |
| SQL injection prevention | SQLAlchemy parameterized queries | Code grep: no `f"SELECT ... {user_input}"` or `.format()` in queries |
| Rate limiting | slowapi on FastAPI | Hammer login endpoint 10× in a minute → 429 after 5 |
| Logging hygiene | No PII in logs | grep backend logs for known test email/phone — should appear zero times |

### 2.2 GDPR / privacy obligations (any EU user triggers these)

- [ ] **Privacy policy** published on marketing site footer + linked from signup flow
- [ ] **Terms of Service** same surface
- [ ] **Data export endpoint**: user can download their data as JSON or CSV
- [ ] **Data deletion endpoint**: user can delete their account. Cascading delete removes:
  - All their events
  - All attendees of those events
  - All seating arrangements, schedule items, custom forms
  - All restaurant-share tokens
  - All notification logs containing their data
  - Verify by deleting test account and inspecting DB afterward
- [ ] **Cookie consent banner** (when analytics added)
- [ ] **Data processor agreements** signed/acknowledged with: Supabase, Render, Cloudflare, Gemini, Resend, Twilio. Most are standard click-through DPAs.

### 2.3 Account-takeover defences

- [ ] Login rate limit (5 attempts / minute / IP) — slowapi
- [ ] Supabase Auth: enforce min password length (12 chars), check against breach dictionaries
- [ ] Password reset emails go via verified domain (post-Resend DNS verification)
- [ ] Optional: enable Supabase MFA for end-user accounts (Phase II UX)

### 2.4 Specific to attendee data

Attendee records contain PII: names, emails, phones, dietary requirements.

- [ ] All routes returning attendee data require a valid JWT (Phase 4)
- [ ] All attendee queries scoped to the requesting user's events (Phase 4)
- [ ] Restaurant share tokens use `secrets.token_urlsafe(32)` (256 bits — already ✓)
- [ ] Public event tokens same (already ✓)
- [ ] No bulk-export API; only per-event export by the owner

---

## §3 — Pre-Public-Launch Final Pass (run before marketing site flips off waitlist)

Run §1 + §2 again from top to bottom. Then:

### 3.1 Backups

- [ ] Supabase upgraded to Pro (daily backups enabled)
- [ ] Perform a test restore: restore a recent backup into a staging DB, verify integrity. "We have backups" without ever restoring is a known liar.
- [ ] Document the restore procedure in a runbook entry.

### 3.2 Monitoring & alerts

- [ ] Sentry (or equivalent) on backend and frontend; verified by triggering a test error
- [ ] Uptime monitoring (UptimeRobot free) on `/api/events`; verified by stopping the backend → alert fires
- [ ] Render spend alerts active
- [ ] Gemini billing budgets active
- [ ] Twilio spending limits active (when wired)

### 3.3 Incident response basics

- [ ] Documented procedure for: leaked key (revoke + rotate), suspected breach (lock down + audit logs), DB corruption (restore from backup), backend down (scale up or rollback)
- [ ] Off-hours contact path defined (you on-call by default; document escalation)

### 3.4 Final scan

- [ ] Search git history for accidentally-committed secrets:
  ```
  git log -p | grep -iE "(SUPABASE_SERVICE_KEY|GEMINI_API_KEY|TWILIO_AUTH_TOKEN|SECRET_KEY)\s*=\s*[A-Za-z0-9]"
  ```
  Should return nothing. If anything appears, that secret needs another rotation and the offending commit needs reviewing.
- [ ] Check `frontend/dist/` after build: no service keys / private keys in the bundle. Only `VITE_*` values should be reachable.

---

## Reference: the rotation log

Maintain a running record so we know when each secret was last rotated.
Suggested format — append entries here as you rotate.

```
2026-??-??  Supabase service key      rotated by Dani  (reason: pre-launch hardening)
2026-??-??  Supabase JWT secret       rotated by Dani  (reason: pre-launch hardening)
2026-??-??  Gemini API key            rotated by Dani  (reason: pre-launch hardening)
2026-??-??  SECRET_KEY                generated         (reason: pre-launch hardening)
```
