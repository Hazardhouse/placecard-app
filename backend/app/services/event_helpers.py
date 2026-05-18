"""
Small cross-cutting helpers for event-level lookups that more than
one router / scheduler needs. Kept here (rather than on the router
that first wanted them) so callers don't import each other.
"""
from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.event import Event
from app.models.profile import Profile


def resolve_organizer_name(db: Session, event: Event) -> str:
    """Human-readable name of the event's host, used in the subject and
    body copy of every outbound email tied to an event.

    Priority:
      1. Profile.display_name for the event creator (event.user_id).
         Profiles auto-provision on first authenticated load, so every
         live host should hit this branch.
      2. "Your Event Organizer" — last-resort fallback for:
         - Anonymous dev events (require_auth=False, event.user_id ==
           "anonymous"); no profile row exists.
         - Pre-profile legacy events where the user has since deleted
           their account.
         The placeholder used to be hard-coded into every email
         caller — Dani called it out on 2026-05-18 as the obvious tell
         that the email was a template. Now it's just a graceful
         fallback when we genuinely don't know the name.
    """
    if event.user_id and event.user_id != "anonymous":
        profile = (
            db.query(Profile)
            .filter(Profile.user_id == event.user_id)
            .first()
        )
        if profile and profile.display_name:
            return profile.display_name
    return "Your Event Organizer"
