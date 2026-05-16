from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user
from app.database import get_db
from app.models.event import Event
from app.models.notification import NotificationLog, NotificationSettings

router = APIRouter(prefix="/api/settings", tags=["settings"])

# Plan limits — must match the published tiers on placecard-events.app.
# `None` = unlimited (Enterprise). In production these would come from a
# billing/plan table; for now they're hardcoded against the marketing site.
PLAN_LIMITS = {
    "Free":          {"sms": 0,    "whatsapp": 0},
    "Socialite":     {"sms": 500,  "whatsapp": 500},
    "Event Planner": {"sms": 2000, "whatsapp": 2000},
    "Enterprise":    {"sms": None, "whatsapp": None},
}


class NotificationSettingsSchema(BaseModel):
    event_reminders: bool = True
    reminder_minutes: int = 60
    include_google_maps_link: bool = True
    sms_enabled: bool = False
    whatsapp_enabled: bool = False


class MessageUsageSchema(BaseModel):
    sms_used: int
    sms_limit: Optional[int]  # None = unlimited (Enterprise)
    whatsapp_used: int
    whatsapp_limit: Optional[int]
    plan: str


def _settings_for_user(user: CurrentUser, db: Session) -> NotificationSettings:
    """Resolve the caller's notification_settings row, creating one on demand.

    Each user owns exactly one row. We scope by user_id and create the
    row lazily the first time the caller hits the settings page rather
    than pre-seeding on signup — keeps the signup trigger free of
    app-layer concerns and avoids a stale row for users who never
    visit Settings.
    """
    settings = (
        db.query(NotificationSettings)
        .filter(NotificationSettings.user_id == user.id)
        .first()
    )
    if not settings:
        settings = NotificationSettings(user_id=user.id)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


@router.get("/notifications", response_model=NotificationSettingsSchema)
def get_notification_settings(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return _settings_for_user(user, db)


@router.put("/notifications", response_model=NotificationSettingsSchema)
def update_notification_settings(
    data: NotificationSettingsSchema,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    settings = _settings_for_user(user, db)
    settings.event_reminders = data.event_reminders
    settings.reminder_minutes = data.reminder_minutes
    settings.include_google_maps_link = data.include_google_maps_link
    settings.sms_enabled = data.sms_enabled
    settings.whatsapp_enabled = data.whatsapp_enabled
    db.commit()
    db.refresh(settings)
    return settings


@router.get("/message-usage", response_model=MessageUsageSchema)
def get_message_usage(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Per-user message usage this month + the user's plan limits.

    Usage is counted by joining notification_logs through events so
    a user only sees the SMS/WhatsApp they sent — not the platform-wide
    aggregate.
    """
    # TODO(launch): replace with the user's actual plan from a billing/plan
    # table once Stripe (or the chosen processor) is wired in. Hardcoded
    # while the site is on the waitlist.
    plan = "Socialite"
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["Free"])

    now = datetime.utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    def _count(channel: str) -> int:
        q = (
            db.query(func.count(NotificationLog.id))
            .join(Event, Event.id == NotificationLog.event_id)
            .filter(
                NotificationLog.channel == channel,
                NotificationLog.status == "sent",
                NotificationLog.sent_at >= month_start,
                Event.user_id == user.id,
            )
        )
        return q.scalar() or 0

    return MessageUsageSchema(
        sms_used=_count("sms"),
        sms_limit=limits["sms"],
        whatsapp_used=_count("whatsapp"),
        whatsapp_limit=limits["whatsapp"],
        plan=plan,
    )
