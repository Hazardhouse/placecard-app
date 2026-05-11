# Row-Level Security — pending design

**Status**: not yet applied. This document outlines the policies and the
prerequisites that must land before they can be applied safely. Once
each prerequisite is met, lift the SQL below into a real timestamped
migration file (e.g. `20260512_003_enable_rls_app_tables.sql`) and
apply via the Supabase migrations workflow.

## Why this isn't a real migration yet

The app's domain tables (`events`, `attendees`, `tables`,
`seating_arrangements`, `seat_assignments`, `schedule_items`,
`custom_forms`, `form_invitations`, `google_form_connections`,
`notification_settings`, `notification_logs`) currently have **no
concept of ownership** — there's no `owner_id` column tying rows to
a Supabase Auth user. Without that, RLS policies can only be "allow
all" or "deny all" — neither useful.

## Prerequisites (in order)

1. **Add `owner_id UUID` to `events`** via Alembic. Nullable
   initially:
   ```python
   op.add_column("events", sa.Column("owner_id", sa.dialects.postgresql.UUID(as_uuid=True), nullable=True))
   op.create_index("ix_events_owner_id", "events", ["owner_id"])
   ```
2. **Update `backend/app/routers/events.py`**:
   - `create_event` sets `owner_id = current_user.id` (using the
     auth.py dependency).
   - `list_events`, `get_event`, `update_event`, `delete_event`,
     `duplicate_event` filter / verify by `owner_id`.
3. **Update `backend/app/routers/events.py` public routes** —
   `/api/public-event/{token}` deliberately skips the owner check
   because it's a tokenised public surface.
4. **Backfill existing events** with an owner. In production Postgres,
   the DB is currently empty so backfill is N/A. If we migrate any
   SQLite data over, every event must get an owner before the next
   step.
5. **Make `events.owner_id NOT NULL`** via a follow-up Alembic
   migration. Only after the backfill above.
6. **Flip on `REQUIRE_AUTH=true`** in Render env vars — every API
   call now requires a valid Supabase JWT.
7. **Apply the SQL below** as a Supabase migration. Order matters:
   parent table (`events`) first, then children.

## Intended policies

```sql
-- ============================================================
-- PlaceCard: Row-Level Security on app domain tables
-- ============================================================
-- Pattern: each table is owned (directly or transitively) by a
-- Supabase Auth user. Policies allow read/write only when the
-- caller's auth.uid() matches the owner's UUID.
--
-- Service-role key (used by the FastAPI backend's admin operations)
-- bypasses RLS entirely. Anon key + signed-in user JWTs are
-- subject to these policies.

-- ── events (top of the ownership tree) ──────────────────────────
alter table public.events enable row level security;

create policy events_owner_select on public.events
  for select using (owner_id = auth.uid());

create policy events_owner_insert on public.events
  for insert with check (owner_id = auth.uid());

create policy events_owner_update on public.events
  for update using (owner_id = auth.uid())
            with check (owner_id = auth.uid());

create policy events_owner_delete on public.events
  for delete using (owner_id = auth.uid());

-- ── child tables (ownership via parent event_id) ────────────────
-- Helper: a row in <table> is visible iff its event is visible.
-- Repeat the pattern for every child table.

alter table public.attendees enable row level security;
create policy attendees_via_event on public.attendees
  for all
  using (event_id in (select id from public.events where owner_id = auth.uid()))
  with check (event_id in (select id from public.events where owner_id = auth.uid()));

alter table public.tables enable row level security;
create policy tables_via_event on public.tables
  for all
  using (event_id in (select id from public.events where owner_id = auth.uid()))
  with check (event_id in (select id from public.events where owner_id = auth.uid()));

alter table public.seating_arrangements enable row level security;
create policy arrangements_via_event on public.seating_arrangements
  for all
  using (event_id in (select id from public.events where owner_id = auth.uid()))
  with check (event_id in (select id from public.events where owner_id = auth.uid()));

alter table public.schedule_items enable row level security;
create policy schedule_via_event on public.schedule_items
  for all
  using (event_id in (select id from public.events where owner_id = auth.uid()))
  with check (event_id in (select id from public.events where owner_id = auth.uid()));

alter table public.custom_forms enable row level security;
create policy forms_via_event on public.custom_forms
  for all
  using (event_id in (select id from public.events where owner_id = auth.uid()))
  with check (event_id in (select id from public.events where owner_id = auth.uid()));

alter table public.google_form_connections enable row level security;
create policy gforms_via_event on public.google_form_connections
  for all
  using (event_id in (select id from public.events where owner_id = auth.uid()))
  with check (event_id in (select id from public.events where owner_id = auth.uid()));

-- ── grandchild tables (ownership via grandparent) ──────────────

alter table public.seat_assignments enable row level security;
create policy seat_assignments_via_arrangement on public.seat_assignments
  for all
  using (
    arrangement_id in (
      select id from public.seating_arrangements
       where event_id in (select id from public.events where owner_id = auth.uid())
    )
  )
  with check (
    arrangement_id in (
      select id from public.seating_arrangements
       where event_id in (select id from public.events where owner_id = auth.uid())
    )
  );

alter table public.form_invitations enable row level security;
create policy form_invitations_via_form on public.form_invitations
  for all
  using (
    form_id in (
      select id from public.custom_forms
       where event_id in (select id from public.events where owner_id = auth.uid())
    )
  )
  with check (
    form_id in (
      select id from public.custom_forms
       where event_id in (select id from public.events where owner_id = auth.uid())
    )
  );

-- ── per-user tables (no event parent) ──────────────────────────

-- notification_settings is a singleton per user. Add a user_id column
-- first, then:
-- alter table public.notification_settings enable row level security;
-- create policy notif_settings_owner on public.notification_settings
--   for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- notification_logs records sends initiated by a user. Add a user_id
-- column first, then mirror the pattern above.

-- ── Public read-only paths (restaurant share, public event page) ─
-- These bypass RLS via tokenised access. Implementation: keep these
-- routes on the FastAPI service-role connection, NOT the user's
-- anon-key session. The backend already does this — service-role
-- bypasses RLS automatically.
```

## Verification once applied

Two test users, A and B. A creates an event. B's authenticated API call
with their own JWT must return zero rows when listing events. Direct
Postgres query with B's JWT context (via `set local role authenticated;
set local request.jwt.claim.sub = '<B_uuid>'`) must return zero rows.

If either check returns A's data with B's identity, RLS is misconfigured.
Fix before letting anyone other than the operator log in.

## Once applied, update

- `LAUNCH-CHECKLIST.md` §4 (Twilio / SMS / WhatsApp is fine but the
  general security section needs the RLS box ticked).
- `SOP-SECURITY-RUNBOOK.md` §2.1 — mark "Row-Level Security" as
  verified with the date.
