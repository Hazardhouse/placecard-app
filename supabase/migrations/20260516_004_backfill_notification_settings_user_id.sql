-- ============================================================
-- PlaceCard: backfill notification_settings.user_id
-- ============================================================
--
-- Run order (production):
--   1. alembic upgrade head   (adds notification_settings.user_id)
--   2. THIS SCRIPT             (assigns the existing global row to Dani)
--
-- Until now notification_settings has been a single global row
-- shared by every account. This script claims the existing row for
-- ahoy@hazardhouse.co so existing toggles aren't lost when settings
-- become per-user.
--
-- Re-run-safe: only touches rows where user_id IS NULL.
-- ============================================================

UPDATE public.notification_settings
SET user_id = (
  SELECT id::text
  FROM auth.users
  WHERE email = 'ahoy@hazardhouse.co'
  LIMIT 1
)
WHERE user_id IS NULL;

-- Sanity check — should report zero rows after a successful backfill.
SELECT count(*) AS unscoped_settings
FROM public.notification_settings
WHERE user_id IS NULL;
