import hashlib
import hmac
import logging
import urllib.parse
from datetime import datetime, timedelta

from app.config import settings

logger = logging.getLogger(__name__)


def make_unsubscribe_token(attendee_id: int) -> str:
    """HMAC-SHA256 of `unsubscribe:{attendee_id}` with the app secret.

    Deterministic so the same token works across multiple emails sent to
    the same attendee. Verifiable without server-side storage. Rotating
    SECRET_KEY invalidates every existing unsubscribe link — that's
    intentional, treat SECRET_KEY rotation as a deliberate ops decision.
    """
    key = (settings.secret_key or "").encode()
    msg = f"unsubscribe:{attendee_id}".encode()
    return hmac.new(key, msg, hashlib.sha256).hexdigest()


def verify_unsubscribe_token(attendee_id: int, token: str) -> bool:
    expected = make_unsubscribe_token(attendee_id)
    try:
        return hmac.compare_digest(expected, token)
    except Exception:
        return False


def _api_host() -> str:
    """Best-effort API host derivation.

    In production frontend_url=https://app.placecard-events.app and the
    API lives at https://api.placecard-events.app. In local dev
    frontend_url=http://localhost:5173 and we keep that — local
    unsubscribe links won't actually fire but the dev test path runs
    against the API host directly anyway.
    """
    fu = (settings.frontend_url or "").rstrip("/")
    if "app." in fu:
        return fu.replace("app.", "api.")
    return fu


def _unsubscribe_url(attendee_id: int) -> str:
    token = make_unsubscribe_token(attendee_id)
    return f"{_api_host()}/api/unsubscribe/{attendee_id}/{token}"


def _unsubscribe_footer_html(attendee_id: int | None) -> str:
    """Footer block with the unsubscribe link. Omitted when we don't
    know the attendee_id (e.g., the initial form invitation goes to
    cold emails that aren't attendees yet).
    """
    if attendee_id is None:
        return ""
    url = _unsubscribe_url(attendee_id)
    return (
        f'<p style="color:#9ca3af;font-size:11px;margin:8px 0 0;">'
        f'Don\'t want event reminders? <a href="{url}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a>.'
        f'</p>'
    )


def _google_calendar_url(
    name: str,
    start: datetime | None,
    end: datetime | None,
    description: str | None,
    location: str | None,
) -> str:
    """Build a Google Calendar 'add event' URL with the event prefilled.

    Falls back to a generic 'now + 2h' window when the event has no
    start time — the customer can adjust on Google's side.
    """
    if not start:
        start = datetime.utcnow() + timedelta(days=1)
    if not end or end <= start:
        end = start + timedelta(hours=2)
    dates = f"{start.strftime('%Y%m%dT%H%M%SZ')}/{end.strftime('%Y%m%dT%H%M%SZ')}"
    params = {
        "action": "TEMPLATE",
        "text": name or "Event",
        "dates": dates,
        "details": description or "",
        "location": location or "",
    }
    return "https://calendar.google.com/calendar/render?" + urllib.parse.urlencode(params)


def send_form_invitation(
    to_email: str,
    event_name: str,
    form_url: str,
    organizer_name: str,
    organizer_email: str,
    event_date: str | None = None,
) -> bool:
    """Send a branded form invitation email via Resend."""
    try:
        import resend

        resend.api_key = settings.resend_api_key
        if not resend.api_key:
            logger.warning("Resend API key not configured — skipping email")
            return False

        date_line = f"<p style='color:#6b7280;margin:0 0 24px;font-size:15px;'>{event_date}</p>" if event_date else ""

        html = f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <tr><td style="padding:32px 40px 0;">
          <img src="https://placecard-events.app/logo.svg" alt="PlaceCard" width="140" height="36" style="display:block;margin-bottom:24px;border:0;outline:none;text-decoration:none;">
        </td></tr>
        <tr><td style="padding:0 40px;">
          <h1 style="font-size:22px;color:#1a1a2e;margin:0 0 8px;">You're invited!</h1>
          <p style="color:#374151;font-size:16px;line-height:1.5;margin:0 0 4px;">
            <strong>{organizer_name}</strong> has invited you to share your details for:
          </p>
          <h2 style="font-size:20px;color:#1a1a2e;margin:8px 0 4px;">{event_name}</h2>
          {date_line}
          <p style="color:#374151;font-size:15px;line-height:1.5;margin:0 0 28px;">
            Please take a moment to fill out the form so we can prepare everything for you.
          </p>
          <a href="{form_url}" style="display:inline-block;background:#1b4fff;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;">
            Fill Out My Details
          </a>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 16px;">
          <p style="color:#9ca3af;font-size:12px;margin:0;">
            Sent via <a href="https://placecard-events.app" style="color:#1b4fff;text-decoration:none;">PlaceCard</a> on behalf of {organizer_name}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
"""

        resend.Emails.send({
            "from": f"PlaceCard Events <{settings.resend_from_email}>",
            "to": [to_email],
            "reply_to": organizer_email,
            "subject": f"{organizer_name} invited you to {event_name}",
            "html": html,
        })

        logger.info(f"Form invitation sent to {to_email} for event '{event_name}'")
        return True

    except Exception as e:
        logger.error(f"Failed to send email to {to_email}: {e}")
        return False


def send_restaurant_share_email(
    to_email: str,
    event_name: str,
    share_url: str,
    organizer_name: str,
    organizer_email: str,
    event_date: str | None = None,
    event_location: str | None = None,
    personal_message: str | None = None,
    variant: str = "attendees",
) -> bool:
    """Send a Dropbox-style 'you've been sent event details' email with the
    restaurant share link.

    ``variant`` controls the subject / body copy: "attendees" for the flat
    guest-list summary, "seating" for the seating chart.
    """
    is_seating = variant == "seating"
    cta_label = "View Seating Chart" if is_seating else "View Event Details"
    body_line = (
        "Click the button below to view the seating chart and each guest's dietary requirements."
        if is_seating
        else "Click the button below to view the attendee list and dietary requirements for catering."
    )
    subject_suffix = "seating chart" if is_seating else "event details"
    try:
        import resend

        resend.api_key = settings.resend_api_key
        if not resend.api_key:
            logger.warning("Resend API key not configured — skipping restaurant email")
            return False

        meta_parts = []
        if event_date:
            meta_parts.append(event_date)
        if event_location:
            meta_parts.append(event_location)
        meta_line = (
            f"<p style='color:#6b7280;margin:0 0 20px;font-size:15px;'>{' · '.join(meta_parts)}</p>"
            if meta_parts else ""
        )

        message_block = ""
        if personal_message and personal_message.strip():
            # Preserve newlines, escape minimal HTML
            safe = (
                personal_message.strip()
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\n", "<br>")
            )
            message_block = f"""
          <div style="background:#f8f9fb;border-left:3px solid #1b4fff;padding:12px 16px;border-radius:4px;margin:0 0 24px;">
            <p style="margin:0;color:#374151;font-size:14px;line-height:1.55;font-style:italic;">{safe}</p>
          </div>
"""

        html = f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <tr><td style="padding:32px 40px 0;">
          <img src="https://placecard-events.app/logo.svg" alt="PlaceCard" width="140" height="36" style="display:block;margin-bottom:24px;border:0;outline:none;text-decoration:none;">
        </td></tr>
        <tr><td style="padding:0 40px;">
          <p style="color:#6b7280;font-size:14px;margin:0 0 20px;">
            You've been sent event details by <strong style="color:#1a1a2e;">{organizer_name}</strong>
            {f'(<a href="mailto:{organizer_email}" style="color:#1b4fff;text-decoration:none;">{organizer_email}</a>)' if organizer_email else ''}.
          </p>
          <h1 style="font-size:22px;color:#1a1a2e;margin:0 0 8px;">{event_name}</h1>
          {meta_line}
          {message_block}
          <p style="color:#374151;font-size:15px;line-height:1.5;margin:0 0 24px;">
            {body_line}
          </p>
          <a href="{share_url}" style="display:inline-block;background:#1b4fff;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;">
            {cta_label}
          </a>
          <p style="color:#9ca3af;font-size:12px;margin:20px 0 0;word-break:break-all;">
            Or paste this link into your browser: <a href="{share_url}" style="color:#1b4fff;text-decoration:none;">{share_url}</a>
          </p>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 16px;">
          <p style="color:#9ca3af;font-size:12px;margin:0;">
            This is a read-only summary. Personal contact details for guests are not shared.
            Sent via <a href="https://placecard-events.app" style="color:#1b4fff;text-decoration:none;">PlaceCard</a>
            on behalf of {organizer_name}.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
"""

        resend.Emails.send({
            "from": f"PlaceCard Events <{settings.resend_from_email}>",
            "to": [to_email],
            "reply_to": organizer_email or settings.resend_from_email,
            "subject": f"{organizer_name} sent you {subject_suffix} — {event_name}",
            "html": html,
        })

        logger.info(f"Restaurant share link sent to {to_email} for event '{event_name}'")
        return True

    except Exception as e:
        logger.error(f"Failed to send restaurant share email to {to_email}: {e}")
        return False


def send_form_confirmation(
    to_email: str,
    guest_name: str,
    event_name: str,
    organizer_name: str,
    public_token: str | None,
    event_start: datetime | None = None,
    event_end: datetime | None = None,
    event_location: str | None = None,
    event_description: str | None = None,
) -> bool:
    """Send a thank-you / confirmation email to a guest after they
    submit the form. Includes Add-to-Calendar buttons (Google +
    .ics download).

    Returns False (silently) when Resend isn't configured or when the
    guest didn't provide an email address. Returns True on a
    successful Resend send.
    """
    if not to_email:
        return False

    try:
        import resend

        resend.api_key = settings.resend_api_key
        if not resend.api_key:
            logger.warning("Resend API key not configured — skipping confirmation")
            return False

        # Calendar URLs. The .ics endpoint is gated by the event's
        # public_token so we need that to be present.
        google_url = _google_calendar_url(
            event_name, event_start, event_end, event_description, event_location,
        )
        ics_url = (
            f"{settings.frontend_url.rstrip('/')}/api/public-event/{public_token}/calendar.ics"
            if public_token
            else ""
        )
        # `frontend_url` is the FE host; the API lives on the
        # `api.` subdomain. Rebuild against the API host instead.
        # In production: frontend_url=https://app.placecard-events.app
        # → API host = https://api.placecard-events.app
        if public_token:
            api_host = settings.frontend_url.replace("app.", "api.").rstrip("/")
            ics_url = f"{api_host}/api/public-event/{public_token}/calendar.ics"

        date_line = ""
        if event_start:
            date_str = event_start.strftime("%A, %B %d, %Y")
            time_str = event_start.strftime("%-I:%M %p") if event_start.time() != event_start.time().min else ""
            if time_str:
                date_line = f"<p style='color:#374151;margin:0 0 4px;font-size:15px;'>{date_str} · {time_str}</p>"
            else:
                date_line = f"<p style='color:#374151;margin:0 0 4px;font-size:15px;'>{date_str}</p>"

        location_line = (
            f"<p style='color:#374151;margin:0 0 24px;font-size:15px;'>{event_location}</p>"
            if event_location else ""
        )

        # Calendar buttons. Stacked, two options. The .ics is only
        # surfaced when we have a token; Google always works.
        ics_button = (
            f'<a href="{ics_url}" style="display:inline-block;background:#ffffff;color:#1b4fff;text-decoration:none;padding:12px 24px;border:1.5px solid #1b4fff;border-radius:8px;font-size:15px;font-weight:600;margin:0 0 10px;">📅 Add to Apple / Outlook</a><br>'
            if ics_url else ""
        )

        html = f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <tr><td style="padding:32px 40px 0;">
          <img src="https://placecard-events.app/logo.svg" alt="PlaceCard" width="140" height="36" style="display:block;margin-bottom:24px;border:0;outline:none;text-decoration:none;">
        </td></tr>
        <tr><td style="padding:0 40px;">
          <h1 style="font-size:22px;color:#1a1a2e;margin:0 0 8px;">Thanks{', ' + guest_name if guest_name else ''}!</h1>
          <p style="color:#374151;font-size:16px;line-height:1.5;margin:0 0 20px;">
            Your details for <strong>{event_name}</strong> are in. {organizer_name} will be in touch with more details soon.
          </p>
          <div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:8px;">
            <h2 style="font-size:18px;color:#1a1a2e;margin:0 0 12px;">{event_name}</h2>
            {date_line}
            {location_line}
            <p style="color:#374151;font-size:14px;line-height:1.5;margin:8px 0 20px;">
              Save the date so you don't miss it:
            </p>
            <a href="{google_url}" style="display:inline-block;background:#1b4fff;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:600;margin:0 0 10px;">📅 Add to Google Calendar</a><br>
            {ics_button}
          </div>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 16px;">
          <p style="color:#9ca3af;font-size:12px;margin:0;">
            Sent via <a href="https://placecard-events.app" style="color:#1b4fff;text-decoration:none;">PlaceCard</a> on behalf of {organizer_name}
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
"""

        resend.Emails.send({
            "from": f"PlaceCard Events <{settings.resend_from_email}>",
            "to": [to_email],
            "subject": f"You're confirmed for {event_name}",
            "html": html,
        })

        logger.info(f"Form confirmation sent to {to_email} for event '{event_name}'")
        return True

    except Exception as e:
        logger.error(f"Failed to send form confirmation to {to_email}: {e}")
        return False


def _send_event_reminder(
    to_email: str,
    attendee_id: int,
    guest_name: str,
    event_name: str,
    organizer_name: str,
    public_token: str | None,
    event_start: datetime | None,
    event_end: datetime | None,
    event_location: str | None,
    event_description: str | None,
    kind: str,  # "week" | "day_before"
) -> bool:
    """Shared sender used by both the 1-week and day-before reminder
    emails. Returns False on any failure (Resend not configured, send
    error, missing recipient address). The caller decides whether to
    write a notification_logs row on success/failure.
    """
    if not to_email:
        return False

    try:
        import resend

        resend.api_key = settings.resend_api_key
        if not resend.api_key:
            logger.warning("Resend API key not configured — skipping reminder")
            return False

        # Calendar URLs (mirror the confirmation email so the buttons
        # are familiar to the guest).
        google_url = _google_calendar_url(
            event_name, event_start, event_end, event_description, event_location,
        )
        api_host = _api_host()
        ics_url = (
            f"{api_host}/api/public-event/{public_token}/calendar.ics"
            if public_token else ""
        )

        # Subject + headline copy by kind.
        if kind == "week":
            subject = f"One week to go: {event_name}"
            headline = "Your event is next week"
            preamble = (
                f"<strong>{event_name}</strong> is just over a week away. "
                f"Make sure it's on your calendar — full details below."
            )
        else:
            subject = f"Tomorrow: {event_name}"
            headline = "See you tomorrow!"
            preamble = (
                f"Quick reminder that <strong>{event_name}</strong> is tomorrow. "
                f"Here's everything you need."
            )

        date_line = ""
        if event_start:
            date_str = event_start.strftime("%A, %B %d, %Y")
            time_str = event_start.strftime("%-I:%M %p") if event_start.time() != event_start.time().min else ""
            date_line = (
                f"<p style='color:#374151;margin:0 0 4px;font-size:15px;'>{date_str} · {time_str}</p>"
                if time_str
                else f"<p style='color:#374151;margin:0 0 4px;font-size:15px;'>{date_str}</p>"
            )

        location_line = (
            f"<p style='color:#374151;margin:0 0 24px;font-size:15px;'>{event_location}</p>"
            if event_location else ""
        )

        ics_button = (
            f'<a href="{ics_url}" style="display:inline-block;background:#ffffff;color:#1b4fff;text-decoration:none;padding:12px 24px;border:1.5px solid #1b4fff;border-radius:8px;font-size:15px;font-weight:600;margin:0 0 10px;">📅 Add to Apple / Outlook</a><br>'
            if ics_url else ""
        )

        unsubscribe_footer = _unsubscribe_footer_html(attendee_id)

        html = f"""
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
        <tr><td style="padding:32px 40px 0;">
          <img src="https://placecard-events.app/logo.svg" alt="PlaceCard" width="140" height="36" style="display:block;margin-bottom:24px;border:0;outline:none;text-decoration:none;">
        </td></tr>
        <tr><td style="padding:0 40px;">
          <h1 style="font-size:22px;color:#1a1a2e;margin:0 0 8px;">{headline}{', ' + guest_name if guest_name else ''}</h1>
          <p style="color:#374151;font-size:16px;line-height:1.5;margin:0 0 20px;">
            {preamble}
          </p>
          <div style="border-top:1px solid #e5e7eb;padding-top:20px;margin-top:8px;">
            <h2 style="font-size:18px;color:#1a1a2e;margin:0 0 12px;">{event_name}</h2>
            {date_line}
            {location_line}
            <a href="{google_url}" style="display:inline-block;background:#1b4fff;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-size:15px;font-weight:600;margin:0 0 10px;">📅 Add to Google Calendar</a><br>
            {ics_button}
          </div>
        </td></tr>
        <tr><td style="padding:32px 40px;">
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 16px;">
          <p style="color:#9ca3af;font-size:12px;margin:0;">
            Sent via <a href="https://placecard-events.app" style="color:#1b4fff;text-decoration:none;">PlaceCard</a> on behalf of {organizer_name}
          </p>
          {unsubscribe_footer}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
"""

        resend.Emails.send({
            "from": f"PlaceCard Events <{settings.resend_from_email}>",
            "to": [to_email],
            "subject": subject,
            "html": html,
        })

        logger.info(f"Reminder email ({kind}) sent to {to_email} for event '{event_name}'")
        return True

    except Exception as e:
        logger.error(f"Failed to send reminder email ({kind}) to {to_email}: {e}")
        return False


def send_event_reminder_week(
    to_email: str,
    attendee_id: int,
    guest_name: str,
    event_name: str,
    organizer_name: str,
    public_token: str | None,
    event_start: datetime | None,
    event_end: datetime | None,
    event_location: str | None,
    event_description: str | None,
) -> bool:
    return _send_event_reminder(
        to_email, attendee_id, guest_name, event_name, organizer_name,
        public_token, event_start, event_end, event_location, event_description,
        kind="week",
    )


def send_event_reminder_day_before(
    to_email: str,
    attendee_id: int,
    guest_name: str,
    event_name: str,
    organizer_name: str,
    public_token: str | None,
    event_start: datetime | None,
    event_end: datetime | None,
    event_location: str | None,
    event_description: str | None,
) -> bool:
    return _send_event_reminder(
        to_email, attendee_id, guest_name, event_name, organizer_name,
        public_token, event_start, event_end, event_location, event_description,
        kind="day_before",
    )
