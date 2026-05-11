from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
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


@router.get("/notifications", response_model=NotificationSettingsSchema)
def get_notification_settings(db: Session = Depends(get_db)):
    settings = db.query(NotificationSettings).first()
    if not settings:
        settings = NotificationSettings()
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


@router.put("/notifications", response_model=NotificationSettingsSchema)
def update_notification_settings(
    data: NotificationSettingsSchema,
    db: Session = Depends(get_db),
):
    settings = db.query(NotificationSettings).first()
    if not settings:
        settings = NotificationSettings()
        db.add(settings)

    settings.event_reminders = data.event_reminders
    settings.reminder_minutes = data.reminder_minutes
    settings.include_google_maps_link = data.include_google_maps_link
    settings.sms_enabled = data.sms_enabled
    settings.whatsapp_enabled = data.whatsapp_enabled
    db.commit()
    db.refresh(settings)
    return settings


@router.get("/message-usage", response_model=MessageUsageSchema)
def get_message_usage(db: Session = Depends(get_db)):
    """Get current month's message usage and plan limits."""
    # Current plan — in production, pull from billing/subscription table
    # TODO(launch): replace with the user's actual plan from a billing/plan
    # table once Stripe (or the chosen processor) is wired in. Hardcoded
    # while the site is on the waitlist.
    plan = "Socialite"
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["Free"])

    # Count messages sent this month
    now = datetime.utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    sms_used = (
        db.query(func.count(NotificationLog.id))
        .filter(
            NotificationLog.channel == "sms",
            NotificationLog.status == "sent",
            NotificationLog.sent_at >= month_start,
        )
        .scalar() or 0
    )

    whatsapp_used = (
        db.query(func.count(NotificationLog.id))
        .filter(
            NotificationLog.channel == "whatsapp",
            NotificationLog.status == "sent",
            NotificationLog.sent_at >= month_start,
        )
        .scalar() or 0
    )

    return MessageUsageSchema(
        sms_used=sms_used,
        sms_limit=limits["sms"],
        whatsapp_used=whatsapp_used,
        whatsapp_limit=limits["whatsapp"],
        plan=plan,
    )
