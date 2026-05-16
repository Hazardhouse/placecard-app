import logging

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.config import settings
from app.models import event, attendee, table, seating as seating_models, google_form, schedule as schedule_models  # noqa: F401 - register all models
from app.models import notification as notification_models  # noqa: F401
from app.models import custom_form as custom_form_models  # noqa: F401
from app.models import email_subscriber as email_subscriber_models  # noqa: F401
from app.models import design as design_models  # noqa: F401
from app.routers import attendees, events, fourover, places, seating, tables, schedule, users, settings as settings_router, custom_forms, brand_colors, name_cards, restaurant_share, document_import, unsubscribe, designs

logger = logging.getLogger(__name__)

# Schema is owned by Alembic. Run `alembic upgrade head` against the
# target DB before serving — Render's Start Command does this, and local
# dev should too. The previous on-startup `Base.metadata.create_all` and
# ad-hoc `ALTER TABLE` block are gone (kept in git history at commit
# 7b9dfe8 if needed).

def _start_scheduler():
    """Start the APScheduler background jobs for notification reminders
    (SMS/WhatsApp via Twilio) and event reminder emails (Resend)."""
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from app.services.notifications import check_and_send_reminders
        from app.services.reminder_emails import check_and_send_event_reminder_emails

        scheduler = BackgroundScheduler()
        scheduler.add_job(
            check_and_send_reminders, "interval", minutes=5,
            id="notification_check",
        )
        # Reminder emails: hourly is plenty given the 12-hour and 24-hour
        # windows the job uses, and the notification_logs dedupe.
        scheduler.add_job(
            check_and_send_event_reminder_emails, "interval", minutes=60,
            id="reminder_email_check",
        )
        scheduler.start()
        logger.info("Schedulers started (SMS/WhatsApp every 5 min, reminder emails every 60 min)")
        return scheduler
    except ImportError:
        logger.warning("APScheduler not installed — schedulers disabled. Run: pip install apscheduler")
        return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = _start_scheduler()
    yield
    if scheduler:
        scheduler.shutdown(wait=False)


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)

# Rate limiting (SOP §1.4). Default ceiling protects every endpoint;
# specific routes can override with @limiter.limit("X/period") — e.g.
# login should be 5/minute/IP, invite endpoint 10/hour.
# `get_remote_address` keys by client IP, which is the right default
# for unauthenticated traffic. Once auth.py is enforced we may want
# to switch to keying by user_id for authenticated endpoints.
limiter = Limiter(key_func=get_remote_address, default_limits=["100/minute"])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS — explicit allow-list from env var (no wildcard in production).
# `ALLOWED_ORIGINS` is a comma-separated list of origins. SOP §2.1.
_cors_origins = [o.strip() for o in settings.allowed_origins.split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(events.router)
app.include_router(events.public_router)
app.include_router(attendees.router)
app.include_router(tables.router)
app.include_router(seating.router)
app.include_router(schedule.router)
app.include_router(users.router)
app.include_router(fourover.router)
app.include_router(settings_router.router)
app.include_router(places.router)
app.include_router(custom_forms.router)
app.include_router(brand_colors.router)
app.include_router(name_cards.router)
app.include_router(restaurant_share.router)
app.include_router(document_import.router)
app.include_router(unsubscribe.router)
app.include_router(designs.router)


@app.get("/api/health")
def health_check():
    return {"status": "ok"}
