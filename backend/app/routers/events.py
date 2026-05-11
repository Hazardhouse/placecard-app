import secrets
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.attendee import Attendee
from app.models.custom_form import CustomForm
from app.models.event import Event
from app.models.schedule import ScheduleItem
from app.models.seating import SeatAssignment, SeatingArrangement
from app.models.table import Table
from app.schemas.event import EventCreate, EventResponse, EventUpdate

router = APIRouter(prefix="/api/events", tags=["events"])


@router.get("", response_model=List[EventResponse])
def list_events(db: Session = Depends(get_db)):
    events = db.query(Event).order_by(Event.created_at.desc()).all()
    result = []
    for event in events:
        resp = EventResponse.model_validate(event)
        resp.attendee_count = len(event.attendees)
        result.append(resp)
    return result


@router.post("", response_model=EventResponse, status_code=201)
def create_event(data: EventCreate, db: Session = Depends(get_db)):
    event = Event(**data.model_dump(), public_token=secrets.token_urlsafe(32))
    db.add(event)
    db.commit()
    db.refresh(event)
    resp = EventResponse.model_validate(event)
    resp.attendee_count = 0
    return resp


@router.get("/{event_id}", response_model=EventResponse)
def get_event(event_id: int, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    resp = EventResponse.model_validate(event)
    resp.attendee_count = len(event.attendees)
    return resp


@router.patch("/{event_id}", response_model=EventResponse)
def update_event(event_id: int, data: EventUpdate, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    for key, value in data.model_dump(exclude_unset=True).items():
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


@router.delete("/{event_id}", status_code=204)
def delete_event(event_id: int, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    db.delete(event)
    db.commit()


@router.post("/{event_id}/duplicate", response_model=EventResponse, status_code=201)
def duplicate_event(event_id: int, db: Session = Depends(get_db)):
    """Deep-clone an event with all of its history: attendees, tables,
    schedule items (with meal_options), seating arrangements, seat
    assignments, and custom forms. Share tokens are intentionally NOT
    carried over — existing public links stay pointing at the original
    event until the organizer regenerates them on the copy.
    """
    source = db.query(Event).filter(Event.id == event_id).first()
    if not source:
        raise HTTPException(status_code=404, detail="Event not found")

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
