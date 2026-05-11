import logging

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import Base, engine
from app.models import event, attendee, table, seating as seating_models, google_form, schedule as schedule_models  # noqa: F401 - register all models
from app.models import notification as notification_models  # noqa: F401
from app.models import custom_form as custom_form_models  # noqa: F401
from app.routers import attendees, events, fourover, places, seating, tables, schedule, users, settings as settings_router, custom_forms, brand_colors, name_cards, restaurant_share, document_import

logger = logging.getLogger(__name__)

Base.metadata.create_all(bind=engine)

# Migrate: add new columns to existing tables if missing
with engine.connect() as conn:
    from sqlalchemy import text
    try:
        conn.execute(text("ALTER TABLE events ADD COLUMN venue_type VARCHAR(100)"))
        conn.commit()
    except Exception:
        pass  # Column already exists

    try:
        conn.execute(text("ALTER TABLE events ADD COLUMN restaurant_share_token VARCHAR(64)"))
        conn.commit()
    except Exception:
        pass  # Column already exists

    try:
        conn.execute(text("ALTER TABLE events ADD COLUMN seating_share_token VARCHAR(64)"))
        conn.commit()
    except Exception:
        pass  # Column already exists

    try:
        conn.execute(text("ALTER TABLE events ADD COLUMN public_token VARCHAR(64)"))
        conn.commit()
    except Exception:
        pass  # Column already exists

    try:
        conn.execute(text("ALTER TABLE events ADD COLUMN image_data TEXT"))
        conn.commit()
    except Exception:
        pass  # Column already exists

    # Backfill: every event needs a public_token. Generate one for any that
    # are missing (e.g. created before this column existed).
    try:
        import secrets as _secrets
        rows = conn.execute(text("SELECT id FROM events WHERE public_token IS NULL")).fetchall()
        for (event_id,) in rows:
            conn.execute(
                text("UPDATE events SET public_token = :tok WHERE id = :id"),
                {"tok": _secrets.token_urlsafe(32), "id": event_id},
            )
        conn.commit()
    except Exception:
        pass

    # Migrate notification_settings
    for col, typ in [
        ("sms_enabled", "BOOLEAN DEFAULT 0"),
        ("whatsapp_enabled", "BOOLEAN DEFAULT 0"),
    ]:
        try:
            conn.execute(text(f"ALTER TABLE notification_settings ADD COLUMN {col} {typ}"))
            conn.commit()
        except Exception:
            pass

    # Migrate notification_logs for channel field
    try:
        conn.execute(text("ALTER TABLE notification_logs ADD COLUMN channel VARCHAR(20) DEFAULT 'sms'"))
        conn.commit()
    except Exception:
        pass

    # Migrate schedule_items for new fields
    for col, typ in [
        ("description", "TEXT"),
        ("assigned_to", "VARCHAR(255)"),
        ("assign_notes", "TEXT"),
        ("meal_options", "TEXT"),
    ]:
        try:
            conn.execute(text(f"ALTER TABLE schedule_items ADD COLUMN {col} {typ}"))
            conn.commit()
        except Exception:
            pass

def _start_scheduler():
    """Start the APScheduler background job for notification reminders."""
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from app.services.notifications import check_and_send_reminders

        scheduler = BackgroundScheduler()
        scheduler.add_job(check_and_send_reminders, "interval", minutes=5, id="notification_check")
        scheduler.start()
        logger.info("Notification scheduler started (checks every 5 minutes)")
        return scheduler
    except ImportError:
        logger.warning("APScheduler not installed — notification scheduler disabled. Run: pip install apscheduler")
        return None


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler = _start_scheduler()
    yield
    if scheduler:
        scheduler.shutdown(wait=False)


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)

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


@app.get("/api/health")
def health_check():
    return {"status": "ok"}
