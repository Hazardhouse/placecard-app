-- ============================================================
-- PlaceCard: backfill events.user_id
-- ============================================================
--
-- Run order (production):
--   1. alembic upgrade head   (adds events.user_id NULL column)
--   2. THIS SCRIPT             (assigns Dani's UUID to all legacy rows)
--   3. Set REQUIRE_AUTH=true on Render and restart the service
--
-- Skipping step 2 before step 3 will make every existing event
-- invisible to its owner (the events router filters by user_id when
-- auth is required, and NULL won't match any user).
--
-- Re-run-safe: only touches rows where user_id IS NULL.
-- ============================================================

UPDATE public.events
SET user_id = (
  SELECT id::text
  FROM auth.users
  WHERE email = 'ahoy@hazardhouse.co'
  LIMIT 1
)
WHERE user_id IS NULL;

-- Sanity check — should report zero rows after a successful backfill.
SELECT count(*) AS unscoped_events FROM public.events WHERE user_id IS NULL;
