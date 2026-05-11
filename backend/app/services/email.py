import logging
from app.config import settings

logger = logging.getLogger(__name__)


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
          <div style="font-size:22px;font-weight:700;color:#1b4fff;margin-bottom:24px;">Place<span style="border:1px solid #1b4fff;border-radius:3px;padding:0 4px;">card</span></div>
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
          <div style="font-size:22px;font-weight:700;color:#1b4fff;margin-bottom:24px;">Place<span style="border:1px solid #1b4fff;border-radius:3px;padding:0 4px;">card</span></div>
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
