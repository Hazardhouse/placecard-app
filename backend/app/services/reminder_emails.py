"""
Event reminder email scheduler.

Two cadences:
  • `event_reminder_week`       — sent ~7 days before event start
  • `event_reminder_day_before` — sent ~1 day before event start

Deduplication is handled by the existing `notification_logs` table:
before sending we check for an existing row matching
(event_id, attendee_id, channel='email', notification_type=<kind>).

Suppression rules:
  • Skip attendees without an email.
  • Skip attendees whose `email_unsubscribed_at` is set (clicked an
    unsubscribe link in a previous reminder).
"""

import logging
from datetime import datetime, timedelta

from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.attendee import Attendee
from app.models.event import Event
from app.models.notification import NotificationLog
from app.services.email import (
    send_event_reminder_day_before,
    send_event_reminder_week,
)

logger = logging.getLogger(__name__)


def _already_sent(
    db: Session, event_id: int, attendee_id: int, kind: str
) -> bool:
    return (
        db.query(NotificationLog)
        .filter(
            NotificationLog.event_id == event_id,
            NotificationLog.attendee_id == attendee_id,
            NotificationLog.channel == "email",
            NotificationLog.notification_type == f"event_reminder_{kind}",
        )
        .first()
        is not None
    )


def _send_for_event(db: Session, event: Event, kind: str) -> int:
    """Send `kind` reminder to every eligible attendee for this event.
    Returns the count of successful sends."""
    sent = 0
    attendees = (
        db.query(Attendee)
        .filter(
            Attendee.event_id == event.id,
            Attendee.email.isnot(None),
            Attendee.email != "",
            Attendee.email_unsubscribed_at.is_(None),
        )
        .all()
    )

    for a in attendees:
        if _already_sent(db, event.id, a.id, kind):
            continue

        if kind == "week":
            ok = send_event_reminder_week(
                to_email=a.email,
                attendee_id=a.id,
                guest_name=a.name or "",
                event_name=event.name,
                organizer_name="Your Event Organizer",
                public_token=event.public_token,
                event_start=event.start_date,
                event_end=event.end_date,
                event_location=(event.venue or "") + (
                    (" · " + event.location) if event.venue and event.location else (event.location or "")
                ),
                event_description=event.description,
            )
        else:
            ok = send_event_reminder_day_before(
                to_email=a.email,
                attendee_id=a.id,
                guest_name=a.name or "",
                event_name=event.name,
                organizer_name="Your Event Organizer",
                public_token=event.public_token,
                event_start=event.start_date,
                event_end=event.end_date,
                event_location=(event.venue or "") + (
                    (" · " + event.location) if event.venue and event.location else (event.location or "")
                ),
                event_description=event.description,
            )

        db.add(NotificationLog(
            event_id=event.id,
            attendee_id=a.id,
            notification_type=f"event_reminder_{kind}",
            channel="email",
            status="sent" if ok else "failed",
        ))
        if ok:
            sent += 1

    db.commit()
    return sent


def check_and_send_event_reminder_emails() -> None:
    """Scheduler entry-point.

    Finds events whose start_date falls in the appropriate window and
    sends the matching reminder. Windows are intentionally wide
    (12-hour bands) so we tolerate a missed scheduler tick — combined
    with the notification_logs dedupe, a guest still only ever sees
    one reminder per kind.
    """
    db: Session = SessionLocal()
    try:
        now = datetime.utcnow()

        # ── Week-before window: 6.5 to 7.5 days out ──
        week_lower = now + timedelta(days=6, hours=12)
        week_upper = now + timedelta(days=7, hours=12)
        week_events = (
            db.query(Event)
            .filter(
                Event.start_date.isnot(None),
                Event.start_date >= week_lower,
                Event.start_date <= week_upper,
            )
            .all()
        )
        week_total = 0
        for ev in week_events:
            week_total += _send_for_event(db, ev, "week")

        # ── Day-before window: 12 to 36 hours out ──
        day_lower = now + timedelta(hours=12)
        day_upper = now + timedelta(hours=36)
        day_events = (
            db.query(Event)
            .filter(
                Event.start_date.isnot(None),
                Event.start_date >= day_lower,
                Event.start_date <= day_upper,
            )
            .all()
        )
        day_total = 0
        for ev in day_events:
            day_total += _send_for_event(db, ev, "day_before")

        logger.info(
            "Reminder email run complete: "
            f"week={week_total} ({len(week_events)} events), "
            f"day_before={day_total} ({len(day_events)} events)"
        )
    except Exception:
        logger.exception("Error in reminder email scheduler")
        db.rollback()
    finally:
        db.close()
