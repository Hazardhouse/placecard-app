"""
Public unsubscribe endpoint.

Reached from the footer of every event reminder email. The link is
self-verifying via HMAC-SHA256 so there's no DB lookup just to render
the page — we only touch the DB when stamping
`email_unsubscribed_at`.

Returns a small branded HTML page on success or failure so the
recipient gets immediate confirmation without bouncing through the
SPA.
"""
from datetime import datetime

from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.attendee import Attendee
from app.services.email import verify_unsubscribe_token

router = APIRouter(tags=["unsubscribe"])


def _render_page(title: str, body: str) -> HTMLResponse:
    html = f"""
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{title} · PlaceCard</title>
  <style>
    body {{
      margin:0; padding:0; background:#f4f5f7;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
      color:#1a1a2e;
    }}
    .wrap {{ max-width:520px; margin:60px auto; padding:0 24px; }}
    .card {{
      background:#ffffff; border-radius:12px; padding:40px;
      box-shadow:0 1px 3px rgba(0,0,0,0.08); text-align:center;
    }}
    h1 {{ margin:0 0 12px; font-size:22px; }}
    p  {{ margin:0 0 8px; color:#374151; font-size:15px; line-height:1.5; }}
    .logo {{ width:140px; margin:0 0 24px; }}
    a.btn {{
      display:inline-block; background:#1b4fff; color:#fff;
      text-decoration:none; padding:10px 22px; border-radius:8px;
      margin-top:20px; font-weight:600;
    }}
  </style>
</head>
<body>
  <div class="wrap"><div class="card">
    <img src="https://placecard-events.app/logo.svg" class="logo" alt="PlaceCard">
    <h1>{title}</h1>
    {body}
    <a class="btn" href="https://placecard-events.app">Back to PlaceCard</a>
  </div></div>
</body>
</html>
"""
    return HTMLResponse(content=html)


@router.get("/api/unsubscribe/{attendee_id}/{token}", response_class=HTMLResponse)
def unsubscribe(attendee_id: int, token: str, db: Session = Depends(get_db)):
    if not verify_unsubscribe_token(attendee_id, token):
        return _render_page(
            "Link not valid",
            "<p>This unsubscribe link doesn't appear to be valid — it may be malformed or expired.</p>"
            "<p>If you're still getting emails you don't want, reply to any PlaceCard email "
            "and we'll handle it manually.</p>",
        )

    attendee = db.query(Attendee).filter(Attendee.id == attendee_id).first()
    if not attendee:
        # Verified token but the attendee has been deleted — treat as
        # already-unsubscribed since there's nothing to remind anyway.
        return _render_page(
            "You're unsubscribed",
            "<p>You won't receive any more event reminders from PlaceCard.</p>",
        )

    if not attendee.email_unsubscribed_at:
        attendee.email_unsubscribed_at = datetime.utcnow()
        db.commit()

    return _render_page(
        "You're unsubscribed",
        f"<p>Got it — we won't send any more reminder emails to <strong>{attendee.email}</strong>.</p>"
        "<p>You'll still receive transactional confirmations when you submit a new event form, "
        "but no more pre-event reminders.</p>",
    )
