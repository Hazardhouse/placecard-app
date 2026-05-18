import secrets
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.auth import CurrentUser, get_current_user
from app.database import get_db
from app.models.attendee import Attendee
from app.models.custom_form import CustomForm
from app.models.event import Event
from app.models.schedule import ScheduleItem
from app.models.seating import SeatAssignment, SeatingArrangement
from app.models.table import Table
from app.schemas.event import EventCreate, EventResponse, EventUpdate
from app.services.workspace_access import (
    active_workspace_ids,
    ensure_personal_workspace,
)

router = APIRouter(prefix="/api/events", tags=["events"])


def get_user_event(
    event_id: int,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Event:
    """Resolve an event by ID and assert the caller has access to it
    via workspace membership.

    Returns 404 (not 403) for both missing-event and not-a-member cases
    so existence doesn't leak across accounts. In dev with
    `require_auth=False` the user is anonymous and the membership filter
    is skipped — every event is reachable, preserving local-dev
    ergonomics. Production with `require_auth=True` enforces.

    Used as a FastAPI dependency from child routers (attendees,
    tables, schedule, seating, custom_forms) so they only need the
    one-line `event: Event = Depends(get_user_event)` and the
    ownership check is consistent in one place.
    """
    q = db.query(Event).filter(Event.id == event_id)
    if not user.is_anonymous:
        ws_ids = active_workspace_ids(db, user)
        # Either the event is in one of the caller's workspaces, OR
        # (legacy fallback) the caller is the original creator.
        # The OR-user_id branch covers events created before the
        # workspace_id backfill landed; once Slice 1 is fully bedded
        # in we can drop it.
        from sqlalchemy import or_
        q = q.filter(
            or_(
                Event.workspace_id.in_(ws_ids) if ws_ids else False,
                Event.user_id == user.id,
            )
        )
    event = q.first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


@router.get("", response_model=List[EventResponse])
def list_events(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(Event).order_by(Event.created_at.desc())
    if not user.is_anonymous:
        # Show every event in any workspace the caller is a member of.
        # OR clause covers legacy events with no workspace_id yet.
        ws_ids = active_workspace_ids(db, user)
        from sqlalchemy import or_
        q = q.filter(
            or_(
                Event.workspace_id.in_(ws_ids) if ws_ids else False,
                Event.user_id == user.id,
            )
        )
    events = q.all()
    if not events:
        return []

    # Single aggregate query for attendee counts — avoids the N+1
    # `len(event.attendees)` pattern that fired one SELECT per event
    # just to count children. Big speedup on accounts with many events.
    from sqlalchemy import func
    from app.models.attendee import Attendee
    event_ids = [e.id for e in events]
    counts = dict(
        db.query(Attendee.event_id, func.count(Attendee.id))
        .filter(Attendee.event_id.in_(event_ids))
        .group_by(Attendee.event_id)
        .all()
    )

    result = []
    for event in events:
        resp = EventResponse.model_validate(event)
        resp.attendee_count = counts.get(event.id, 0)
        result.append(resp)
    return result


def _validate_salon_ownership(db: Session, salon_id: Optional[int], user: CurrentUser) -> None:
    """Ensure the caller owns the salon they're attaching an event to.
    Without this, a user could attach their event to another host's
    salon by guessing IDs.
    """
    if salon_id is None:
        return
    from app.models.salon import Salon
    salon = db.query(Salon).filter(Salon.id == salon_id).first()
    if not salon:
        raise HTTPException(status_code=400, detail="Salon not found.")
    if not user.is_anonymous and salon.host_user_id != user.id:
        # 404 not 403 — don't leak existence of another user's salon.
        raise HTTPException(status_code=400, detail="Salon not found.")


@router.post("", response_model=EventResponse, status_code=201)
def create_event(
    data: EventCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _validate_salon_ownership(db, data.salon_id, user)
    # Make sure the user has a personal workspace they own — new events
    # land in it. Idempotent for the common case where it already exists.
    workspace_id: Optional[int] = None
    if not user.is_anonymous:
        ws = ensure_personal_workspace(db, user)
        workspace_id = ws.id
    event = Event(
        **data.model_dump(),
        public_token=secrets.token_urlsafe(32),
        # Always populated — the AnonymousUser sentinel uses id='anonymous'
        # in dev (require_auth=False); prod requests carry the real Supabase UUID.
        user_id=user.id,
        workspace_id=workspace_id,
    )
    db.add(event)
    db.commit()
    db.refresh(event)
    resp = EventResponse.model_validate(event)
    resp.attendee_count = 0
    return resp


@router.get("/{event_id}", response_model=EventResponse)
def get_event(event: Event = Depends(get_user_event)):
    resp = EventResponse.model_validate(event)
    resp.attendee_count = len(event.attendees)
    return resp


@router.patch("/{event_id}", response_model=EventResponse)
def update_event(
    data: EventUpdate,
    event: Event = Depends(get_user_event),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    updates = data.model_dump(exclude_unset=True)
    if "salon_id" in updates:
        _validate_salon_ownership(db, updates["salon_id"], user)
    for key, value in updates.items():
        setattr(event, key, value)
    db.commit()
    db.refresh(event)
    resp = EventResponse.model_validate(event)
    resp.attendee_count = len(event.attendees)
    return resp


# ── Public endpoint: anyone with the token can view a read-only summary ──
public_router = APIRouter(prefix="/api", tags=["public-event"])


@public_router.get("/public-event/{token}", response_model=EventResponse)
def get_public_event(token: str, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.public_token == token).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    resp = EventResponse.model_validate(event)
    resp.attendee_count = len(event.attendees)
    return resp


def _ics_escape(text: str) -> str:
    """Escape special characters for the iCalendar format."""
    return (
        text.replace("\\", "\\\\")
            .replace(";", "\\;")
            .replace(",", "\\,")
            .replace("\n", "\\n")
    )


@public_router.get("/public-event/{token}/calendar.ics")
def get_event_calendar(token: str, db: Session = Depends(get_db)) -> Response:
    """Generate an iCalendar (.ics) file for the event.

    Linked from confirmation emails and the public event page so
    attendees can add the event to Apple Calendar, Outlook, etc.
    Google Calendar uses a different mechanism (templated URL) and
    doesn't need this endpoint.
    """
    event = db.query(Event).filter(Event.public_token == token).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    # Stored datetimes are naive UTC (we strip the Z on insert). Convert
    # back to UTC for the .ics output. If a start time isn't set, fall
    # back to a sensible default so the file is still valid.
    start = event.start_date or datetime.utcnow()
    end = event.end_date or (start + timedelta(hours=2))
    # Single-day events stored with end == start get a default 2-hour
    # duration so calendar apps don't render them as zero-length.
    if end <= start:
        end = start + timedelta(hours=2)

    summary = _ics_escape(event.name or "Event")
    description = _ics_escape(event.description or "")
    location_parts = [p for p in (event.venue, event.location) if p]
    location = _ics_escape(" · ".join(location_parts))
    now_stamp = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    start_stamp = start.strftime("%Y%m%dT%H%M%SZ")
    end_stamp = end.strftime("%Y%m%dT%H%M%SZ")

    body = (
        "BEGIN:VCALENDAR\r\n"
        "VERSION:2.0\r\n"
        "PRODID:-//PlaceCard//Event//EN\r\n"
        "CALSCALE:GREGORIAN\r\n"
        "METHOD:PUBLISH\r\n"
        "BEGIN:VEVENT\r\n"
        f"UID:placecard-event-{event.id}@placecard-events.app\r\n"
        f"DTSTAMP:{now_stamp}\r\n"
        f"DTSTART:{start_stamp}\r\n"
        f"DTEND:{end_stamp}\r\n"
        f"SUMMARY:{summary}\r\n"
        f"DESCRIPTION:{description}\r\n"
        f"LOCATION:{location}\r\n"
        "END:VEVENT\r\n"
        "END:VCALENDAR\r\n"
    )
    return Response(
        content=body,
        media_type="text/calendar; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{event.name}.ics"',
        },
    )


@router.delete("/{event_id}", status_code=204)
def delete_event(
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    db.delete(event)
    db.commit()


@router.post("/{event_id}/duplicate", response_model=EventResponse, status_code=201)
def duplicate_event(
    source: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    """Deep-clone an event with all of its history: attendees, tables,
    schedule items (with meal_options), seating arrangements, seat
    assignments, and custom forms. Share tokens are intentionally NOT
    carried over — existing public links stay pointing at the original
    event until the organizer regenerates them on the copy.
    """
    # 1) New event metadata — strip tokens so old links don't leak
    new_event = Event(
        name=f"{source.name} (Copy)",
        start_date=source.start_date,
        end_date=source.end_date,
        location=source.location,
        venue=source.venue,
        venue_type=source.venue_type,
        event_category=source.event_category,
        description=source.description,
        image_data=source.image_data,
        user_id=source.user_id,
        # restaurant_share_token + seating_share_token are intentionally left None
        # Fresh public_token so the copy gets its own public URL
        public_token=secrets.token_urlsafe(32),
    )
    db.add(new_event)
    db.flush()  # assigns new_event.id without committing

    # 2) Attendees — build an old_id → new_id map for later reference fix-ups
    attendee_id_map: dict[int, int] = {}
    for a in source.attendees:
        new_a = Attendee(
            event_id=new_event.id,
            name=a.name,
            email=a.email,
            phone=a.phone,
            dietary_requirements=a.dietary_requirements,
            responses=a.responses,  # preserves meal_selections + custom form answers
            notes=a.notes,
            country=a.country,
            rsvp_status=a.rsvp_status,
            # google_form_response_id intentionally skipped to avoid duplicate-key collisions
        )
        db.add(new_a)
        db.flush()
        attendee_id_map[a.id] = new_a.id

    # 3) Tables — same pattern
    src_tables = db.query(Table).filter(Table.event_id == source.id).all()
    table_id_map: dict[int, int] = {}
    for t in src_tables:
        new_t = Table(
            event_id=new_event.id,
            name=t.name,
            shape=t.shape,
            width=t.width,
            height=t.height,
            capacity=t.capacity,
            x_position=t.x_position,
            y_position=t.y_position,
            rotation=t.rotation,
        )
        db.add(new_t)
        db.flush()
        table_id_map[t.id] = new_t.id

    # 4) Schedule items — includes meal_options JSON
    src_schedule = db.query(ScheduleItem).filter(ScheduleItem.event_id == source.id).all()
    for si in src_schedule:
        db.add(ScheduleItem(
            event_id=new_event.id,
            title=si.title,
            description=si.description,
            start_time=si.start_time,
            end_time=si.end_time,
            venue_name=si.venue_name,
            venue_type=si.venue_type,
            location=si.location,
            notes=si.notes,
            requires_seating=si.requires_seating,
            assigned_to=si.assigned_to,
            assign_notes=si.assign_notes,
            meal_options=si.meal_options,
            sort_order=si.sort_order,
        ))

    # 5) Seating arrangements + their seat assignments (translated through the maps)
    src_arrangements = (
        db.query(SeatingArrangement)
        .filter(SeatingArrangement.event_id == source.id)
        .all()
    )
    for arr in src_arrangements:
        new_arr = SeatingArrangement(
            event_id=new_event.id,
            name=arr.name,
        )
        db.add(new_arr)
        db.flush()
        for sa in arr.seat_assignments:
            # Only carry assignments where BOTH attendee and table survived the copy
            new_att_id = attendee_id_map.get(sa.attendee_id)
            new_tbl_id = table_id_map.get(sa.table_id)
            if new_att_id is None or new_tbl_id is None:
                continue
            db.add(SeatAssignment(
                arrangement_id=new_arr.id,
                attendee_id=new_att_id,
                table_id=new_tbl_id,
                seat_number=sa.seat_number,
            ))

    # 6) Custom forms — copy shape, give each a brand-new share token so old
    #    invites keep pointing at the original event's form
    src_forms = db.query(CustomForm).filter(CustomForm.event_id == source.id).all()
    for f in src_forms:
        db.add(CustomForm(
            event_id=new_event.id,
            title=f.title,
            description=f.description,
            fields=f.fields,
            share_token=secrets.token_urlsafe(32),
            is_active=f.is_active,
        ))

    db.commit()
    db.refresh(new_event)

    resp = EventResponse.model_validate(new_event)
    resp.attendee_count = len(attendee_id_map)
    return resp
