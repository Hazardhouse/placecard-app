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


# ── Print-order fulfillment ─────────────────────────────────────────────


def _extension_for_mime(mime: str | None) -> str:
    """Best-effort filename extension for an image MIME type."""
    if not mime:
        return "png"
    mime = mime.lower()
    if "jpeg" in mime or "jpg" in mime:
        return "jpg"
    if "gif" in mime:
        return "gif"
    if "webp" in mime:
        return "webp"
    return "png"


def _print_order_attachments(order, *, include_csv: bool = True) -> list[dict]:
    """Build the Resend attachments payload for a print order:
    one entry per design view (Front, Back, etc.) plus optionally an
    attendees CSV.

    `order` is the PrintOrder ORM row; we read the frozen snapshots
    off it so the email reflects exactly what was paid for.

    `include_csv=False` strips the attendee CSV — used for the customer
    receipt, where exposing attendees would leak the print pipeline
    (and isn't useful to the buyer).
    """
    import base64
    import csv
    import io

    attachments: list[dict] = []

    # Design views — multi-view designs (Front + Back) get one
    # attachment per view; single-view designs get one PNG.
    if order.design_views_json:
        for i, view in enumerate(order.design_views_json):
            label = (view.get("label") or f"view-{i + 1}").lower().replace(" ", "-")
            ext = _extension_for_mime(view.get("mime_type"))
            attachments.append({
                "filename": f"design-{order.id}-{label}.{ext}",
                "content": view["image_b64"],
            })
    else:
        ext = _extension_for_mime(order.design_mime_type)
        attachments.append({
            "filename": f"design-{order.id}.{ext}",
            "content": order.design_image_b64,
        })

    if include_csv:
        # Attendees CSV — what to actually print on the cards.
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["Name", "Table", "Dietary"])
        for a in (order.attendees_json or []):
            writer.writerow([
                a.get("name", ""),
                a.get("table_name", ""),
                a.get("dietary", "") or "",
            ])
        csv_b64 = base64.b64encode(buf.getvalue().encode("utf-8")).decode("ascii")
        attachments.append({
            "filename": f"attendees-order-{order.id}.csv",
            "content": csv_b64,
        })

    return attachments


def _money_str(amount_cents: int, currency: str) -> str:
    symbol = {"USD": "$", "GBP": "£"}.get(currency.upper(), currency.upper() + " ")
    return f"{symbol}{amount_cents / 100:.2f}"


def _render_print_files_section(render_results, *, total_attendees: int | None = None) -> str:
    """Build the per-attendee 'Print files' section of the fulfillment
    email — a list of attendee names with front/back download links.

    Returns "" when no render results are provided (the synchronous
    fallback path; pre-render-job behaviour). Renders a clear table
    with successes + failures broken out when results are present.

    `total_attendees` is the full headcount on the order. When the
    render pipeline only generated a sample (e.g. 3 templates for a
    24-attendee order), the status line reads "3 of 24 attendees
    rendered" so the operator knows the rest aren't here.
    """
    if not render_results:
        return ""

    succeeded = [r for r in render_results if r.front_url or r.back_url]
    failed = [r for r in render_results if r.error and not (r.front_url and r.back_url)]

    def _link_or_dash(url, label):
        if url:
            return f'<a href="{url}" style="color:#1b4fff;">{label}</a>'
        return '<span style="color:#94a3b8;">—</span>'

    cell_style = (
        "padding:6px 8px;border-bottom:1px solid #f1f5f9;"
        "font-size:13px;vertical-align:top;"
    )
    rows_html: list[str] = []
    for r in render_results:
        front_link = _link_or_dash(r.front_url, "Front")
        back_link = _link_or_dash(r.back_url, "Back")
        rows_html.append(
            f'<tr>'
            f'<td style="{cell_style}">{r.attendee_name}</td>'
            f'<td style="{cell_style}">{front_link}</td>'
            f'<td style="{cell_style}">{back_link}</td>'
            f'</tr>'
        )

    denominator = total_attendees if total_attendees is not None else len(render_results)
    status_line = (
        f"<p style='margin:0 0 8px;font-size:13px;color:#64748b;'>"
        f"{len(succeeded)} of {denominator} attendees rendered"
        + (f" · {len(failed)} failed" if failed else "")
        + "</p>"
    )

    return f"""
          <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin:24px 0 8px;">Print files (300 DPI JPG, links expire in 24h)</h2>
          {status_line}
          <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px;color:#1e293b;border-top:1px solid #e2e8f0;">
            <tr style="background:#f8fafc;">
              <th style="padding:6px 8px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;font-weight:600;">Attendee</th>
              <th style="padding:6px 8px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;font-weight:600;">Front</th>
              <th style="padding:6px 8px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;font-weight:600;">Back</th>
            </tr>
            {"".join(rows_html)}
          </table>
"""


def _build_print_order_email_html(
    order,
    render_results=None,
    *,
    include_print_files: bool,
    include_stripe_id: bool,
    include_csv_in_attachments_list: bool,
    headline: str,
) -> str:
    """Shared HTML body builder for both the operator fulfillment email
    and the customer receipt.

    Flags carve out the differences between the two recipients:
      - `include_print_files`: per-attendee download links block.
        Operator only — customers must never see the print pipeline.
      - `include_stripe_id`: internal PaymentIntent footer line. Operator only.
      - `include_csv_in_attachments_list`: mention the attendee CSV in
        the body's attachments list. Operator only (the customer doesn't
        get a CSV attached).
      - `headline`: the H1 — "New print order #X" vs "Your PlaceCard order #X".
    """
    total = _money_str(order.total_amount_cents, order.currency)
    base = _money_str(order.base_amount_cents, order.currency)
    shipping = _money_str(order.shipping_amount_cents, order.currency)
    rush_line = (
        f"<tr><td style='padding:4px 0;'>Rush (next-business-day)</td>"
        f"<td style='padding:4px 0;text-align:right;'>{_money_str(order.rush_amount_cents, order.currency)}</td></tr>"
        if order.rush else ""
    )
    branding_line = (
        f"<tr><td style='padding:4px 0;'>Remove PlaceCard branding</td>"
        f"<td style='padding:4px 0;text-align:right;'>{_money_str(order.remove_branding_amount_cents, order.currency)}</td></tr>"
        if order.remove_branding else ""
    )

    address_lines = [order.shipping_address1]
    if order.shipping_address2:
        address_lines.append(order.shipping_address2)
    address_lines.append(
        ", ".join([p for p in (order.shipping_city, order.shipping_state, order.shipping_zip) if p])
    )
    address_lines.append({"US": "United States", "GB": "United Kingdom"}.get(order.shipping_country, order.shipping_country))
    address_html = "<br>".join(address_lines)

    attendee_count = len(order.attendees_json or [])

    print_files_html = (
        _render_print_files_section(render_results, total_attendees=attendee_count)
        if include_print_files else ""
    )
    stripe_footer_html = (
        f'<p style="margin:24px 0 0;font-size:12px;color:#94a3b8;">'
        f'Stripe PaymentIntent: <code style="background:#f1f5f9;padding:1px 6px;border-radius:3px;">'
        f'{order.stripe_payment_intent_id}</code></p>'
        if include_stripe_id else ""
    )
    csv_attachments_line = (
        f"<br>• Attendee list CSV ({attendee_count} rows)"
        if include_csv_in_attachments_list else ""
    )

    return f"""
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>{headline}</title></head>
<body style="margin:0;padding:0;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f7fa;padding:32px 0;">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:32px;">
        <tr><td>
          <h1 style="margin:0 0 6px;font-size:22px;color:#0f172a;">{headline}</h1>
          <p style="margin:0 0 24px;color:#64748b;font-size:14px;">{order.quantity} × {order.content_type} · {attendee_count} attendees · {total}</p>

          <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin:24px 0 8px;">Print specs</h2>
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#1e293b;">
            <tr><td style="padding:4px 0;">Type</td><td style="padding:4px 0;text-align:right;">{order.content_type}</td></tr>
            <tr><td style="padding:4px 0;">Quantity</td><td style="padding:4px 0;text-align:right;">{order.quantity} (charged at tier of {order.quantity_tier})</td></tr>
            <tr><td style="padding:4px 0;">Paper</td><td style="padding:4px 0;text-align:right;">{order.paper_stock}</td></tr>
            <tr><td style="padding:4px 0;">Finish</td><td style="padding:4px 0;text-align:right;">{order.finish}</td></tr>
            <tr><td style="padding:4px 0;">Colour</td><td style="padding:4px 0;text-align:right;">{order.color_spec}</td></tr>
            <tr><td style="padding:4px 0;">Turnaround</td><td style="padding:4px 0;text-align:right;">{order.turnaround_days} business days{' (RUSH)' if order.rush else ''}</td></tr>
            <tr><td style="padding:4px 0;">Branding removed?</td><td style="padding:4px 0;text-align:right;">{'Yes' if order.remove_branding else 'No'}</td></tr>
          </table>

          <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin:24px 0 8px;">Pricing</h2>
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#1e293b;">
            <tr><td style="padding:4px 0;">Cards (×{order.quantity_tier})</td><td style="padding:4px 0;text-align:right;">{base}</td></tr>
            {rush_line}
            {branding_line}
            <tr><td style="padding:4px 0;">Shipping ({order.shipping_country})</td><td style="padding:4px 0;text-align:right;">{shipping}</td></tr>
            <tr><td style="padding:8px 0 4px;border-top:1px solid #e2e8f0;font-weight:600;">Total</td><td style="padding:8px 0 4px;border-top:1px solid #e2e8f0;text-align:right;font-weight:600;">{total}</td></tr>
          </table>

          <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin:24px 0 8px;">Ship to</h2>
          <p style="margin:0;font-size:14px;color:#1e293b;line-height:1.5;">
            <strong>{order.shipping_name}</strong><br>
            {f'{order.shipping_company}<br>' if order.shipping_company else ''}{address_html}<br>
            <a href="mailto:{order.shipping_email}" style="color:#1b4fff;">{order.shipping_email}</a>
          </p>

          {print_files_html}

          <h2 style="font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin:24px 0 8px;">Attachments</h2>
          <p style="margin:0;font-size:14px;color:#1e293b;line-height:1.5;">
            • Source design image(s) — front{' + back' if order.design_views_json else ''} (low-res, for visual reference){csv_attachments_line}
          </p>
          {stripe_footer_html}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
"""


def send_print_order_fulfillment(order, render_results=None) -> bool:
    """Send the OPERATOR notification email for a paid print order.

    Includes order details inline + the chosen design files + an
    attendees CSV as attachments — everything needed to build the
    print-ready file and hand off to the local printer.

    When `render_results` is provided (list of objects with
    attendee_name / front_url / back_url / error attributes from the
    background rendering pipeline), the email also includes signed
    download URLs for each sample template render.

    Returns True on a successful send; False otherwise (logs internally).
    Caller should never let a False here roll back the order's 'paid'
    state — the payment has already cleared at Stripe.
    """
    try:
        import resend

        resend.api_key = settings.resend_api_key
        if not resend.api_key:
            logger.warning("Resend API key not configured — skipping fulfillment email")
            return False
        if not settings.fulfillment_email:
            logger.warning("FULFILLMENT_EMAIL not set — skipping fulfillment email")
            return False

        html = _build_print_order_email_html(
            order,
            render_results,
            include_print_files=True,
            include_stripe_id=True,
            include_csv_in_attachments_list=True,
            headline=f"New print order #{order.id}",
        )

        resend.Emails.send({
            "from": f"PlaceCard Orders <{settings.resend_from_email}>",
            "to": [settings.fulfillment_email],
            "subject": f"New print order #{order.id} — {order.shipping_name} — {order.quantity} {order.content_type}",
            "html": html,
            "attachments": _print_order_attachments(order, include_csv=True),
        })
        logger.info("Print-order fulfillment email sent for order %s", order.id)
        return True

    except Exception:
        logger.exception("Failed to send print-order fulfillment email")
        return False


def send_customer_receipt(order) -> bool:
    """Send the CUSTOMER receipt for a paid print order.

    Same layout as the operator fulfillment email but:
      - No print-files section (customers must not see the print pipeline)
      - No attendee CSV attachment
      - No internal Stripe PaymentIntent footer
      - Goes to the buyer's email (the one they used at checkout, which
        pre-fills from their PlaceCard account email)
      - Subject is buyer-friendly ("Your PlaceCard order #X")

    Fires from the Stripe webhook on payment_intent.succeeded so the
    customer gets confirmation immediately on payment — no waiting on
    the render pipeline.

    Returns True on send; False otherwise. Failure never blocks order
    fulfillment — payment has already cleared.
    """
    try:
        import resend

        resend.api_key = settings.resend_api_key
        if not resend.api_key:
            logger.warning("Resend API key not configured — skipping customer receipt")
            return False
        recipient = (order.shipping_email or "").strip()
        if not recipient:
            logger.warning("Order %s has no shipping_email — skipping customer receipt", order.id)
            return False

        html = _build_print_order_email_html(
            order,
            render_results=None,
            include_print_files=False,
            include_stripe_id=False,
            include_csv_in_attachments_list=False,
            headline=f"Your PlaceCard order #{order.id}",
        )

        resend.Emails.send({
            "from": f"PlaceCard <{settings.resend_from_email}>",
            "to": [recipient],
            "subject": f"Your PlaceCard order #{order.id} — thanks!",
            "html": html,
            "attachments": _print_order_attachments(order, include_csv=False),
        })
        logger.info("Customer receipt sent for order %s to %s", order.id, recipient)
        return True

    except Exception:
        logger.exception("Failed to send customer receipt for order %s", order.id)
        return False
