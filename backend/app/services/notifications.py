"""
Notification scheduler service.

Checks for upcoming schedule items and sends reminders via SMS and/or WhatsApp.
Uses server-side Twilio credentials (from env/config).
Runs as a background task via APScheduler.
"""

import logging
import urllib.parse
from datetime import datetime, timedelta

import httpx
from sqlalchemy import func as sqla_func
from sqlalchemy.orm import Session

from app.config import settings as app_settings
from app.database import SessionLocal
from app.models.attendee import Attendee
from app.models.event import Event
from app.models.notification import NotificationLog, NotificationSettings
from app.models.schedule import ScheduleItem

logger = logging.getLogger(__name__)

# Plan limits — must match routers/settings.py and placecard-events.app.
# `None` = unlimited (Enterprise).
PLAN_LIMITS = {
    "Free":          0,
    "Socialite":     500,
    "Event Planner": 2000,
    "Enterprise":    None,
}
# TODO(launch): replace with per-user plan lookup once billing is wired.
CURRENT_PLAN = "Socialite"


def _google_maps_url(location: str) -> str:
    return f"https://www.google.com/maps/search/?api=1&query={urllib.parse.quote(location)}"


def _send_twilio_message(
    to_number: str, body: str, channel: str = "sms"
) -> bool:
    """Send SMS or WhatsApp via Twilio REST API using server credentials."""
    sid = app_settings.twilio_account_sid
    token = app_settings.twilio_auth_token

    if not sid or not token:
        logger.warning(f"Twilio credentials not configured — skipping {channel} to {to_number}")
        return False

    if channel == "whatsapp":
        from_number = f"whatsapp:{app_settings.twilio_whatsapp_number or app_settings.twilio_phone_number}"
        to_number = f"whatsapp:{to_number}"
    else:
        from_number = app_settings.twilio_phone_number

    if not from_number.replace("whatsapp:", ""):
        logger.warning(f"No Twilio phone number configured for {channel}")
        return False

    try:
        resp = httpx.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
            auth=(sid, token),
            data={"From": from_number, "To": to_number, "Body": body},
            timeout=15,
        )
        if resp.status_code == 201:
            logger.info(f"{channel.upper()} sent to {to_number}")
            return True
        else:
            logger.error(f"{channel.upper()} failed ({resp.status_code}): {resp.text}")
            return False
    except Exception:
        logger.exception(f"{channel.upper()} send error to {to_number}")
        return False


def _build_message(
    attendee_name: str,
    event_name: str,
    item_title: str,
    start_str: str,
    venue: str,
    location: str,
    include_maps: bool,
) -> str:
    lines = [
        f"Hi {attendee_name},",
        "",
        f'Reminder: "{item_title}" is starting soon!',
        "",
        f"Event: {event_name}",
        f"What: {item_title}",
    ]
    if start_str:
        lines.append(f"When: {start_str}")
    if venue:
        lines.append(f"Venue: {venue}")
    if location:
        lines.append(f"Location: {location}")
    if include_maps and location:
        lines.extend(["", f"Get directions: {_google_maps_url(location)}"])
    lines.extend(["", "See you there!"])
    return "\n".join(lines)


def _month_usage(db: Session, channel: str) -> int:
    """Count messages sent this month for a channel."""
    now = datetime.utcnow()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return (
        db.query(sqla_func.count(NotificationLog.id))
        .filter(
            NotificationLog.channel == channel,
            NotificationLog.status == "sent",
            NotificationLog.sent_at >= month_start,
        )
        .scalar() or 0
    )


def check_and_send_reminders():
    """Check for upcoming schedule items and send reminders."""
    db: Session = SessionLocal()
    try:
        settings = db.query(NotificationSettings).first()
        if not settings or not settings.event_reminders:
            return

        channels = []
        if settings.sms_enabled:
            channels.append("sms")
        if settings.whatsapp_enabled:
            channels.append("whatsapp")
        if not channels:
            return

        # Check plan limits
        plan_limit = PLAN_LIMITS.get(CURRENT_PLAN, 500)

        now = datetime.utcnow()
        reminder_window_end = now + timedelta(minutes=settings.reminder_minutes)

        upcoming_items = (
            db.query(ScheduleItem)
            .filter(
                ScheduleItem.start_time.isnot(None),
                ScheduleItem.start_time >= now,
                ScheduleItem.start_time <= reminder_window_end,
            )
            .all()
        )

        for item in upcoming_items:
            event = db.query(Event).filter(Event.id == item.event_id).first()
            if not event:
                continue

            attendees = (
                db.query(Attendee)
                .filter(
                    Attendee.event_id == event.id,
                    Attendee.phone.isnot(None),
                    Attendee.phone != "",
                )
                .all()
            )

            location = item.location or event.location or ""
            venue = item.venue_name or event.venue or ""
            start_str = item.start_time.strftime("%B %d, %Y at %I:%M %p") if item.start_time else ""

            for attendee in attendees:
                body = _build_message(
                    attendee.name, event.name, item.title, start_str,
                    venue, location, settings.include_google_maps_link,
                )

                for channel in channels:
                    # Check plan limit. None = unlimited (Enterprise).
                    if plan_limit is not None and _month_usage(db, channel) >= plan_limit:
                        logger.warning(f"{channel} limit reached ({plan_limit}). Skipping.")
                        continue

                    # Check if already sent
                    already_sent = (
                        db.query(NotificationLog)
                        .filter(
                            NotificationLog.schedule_item_id == item.id,
                            NotificationLog.attendee_id == attendee.id,
                            NotificationLog.channel == channel,
                        )
                        .first()
                    )
                    if already_sent:
                        continue

                    success = _send_twilio_message(attendee.phone, body, channel)

                    log = NotificationLog(
                        event_id=event.id,
                        schedule_item_id=item.id,
                        attendee_id=attendee.id,
                        notification_type="event_reminder",
                        channel=channel,
                        status="sent" if success else "failed",
                    )
                    db.add(log)

            db.commit()

        logger.info(f"Reminder check complete. Checked {len(upcoming_items)} upcoming items.")

    except Exception:
        logger.exception("Error in notification scheduler")
        db.rollback()
    finally:
        db.close()
