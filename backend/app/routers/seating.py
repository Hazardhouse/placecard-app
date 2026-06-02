from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models.event import Event
from app.models.seating import SeatAssignment, SeatingArrangement
from app.models.table import Table
from app.routers.events import get_user_event
from app.schemas.seating import (
    SeatAssignmentCreate,
    SeatAssignmentResponse,
    SeatingArrangementCreate,
    SeatingArrangementResponse,
    SeatingArrangementUpdate,
)

router = APIRouter(prefix="/api/events/{event_id}/seating", tags=["seating"])


@router.get("", response_model=List[SeatingArrangementResponse])
def list_arrangements(
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    return (
        db.query(SeatingArrangement)
        .filter(SeatingArrangement.event_id == event.id)
        .options(
            joinedload(SeatingArrangement.seat_assignments)
            .joinedload(SeatAssignment.attendee),
            joinedload(SeatingArrangement.seat_assignments)
            .joinedload(SeatAssignment.table),
        )
        .all()
    )


@router.post("", response_model=SeatingArrangementResponse, status_code=201)
def create_arrangement(
    data: SeatingArrangementCreate,
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    arrangement = SeatingArrangement(event_id=event.id, name=data.name)
    db.add(arrangement)
    db.commit()
    db.refresh(arrangement)
    return arrangement


@router.get("/{arrangement_id}", response_model=SeatingArrangementResponse)
def get_arrangement(
    arrangement_id: int,
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    arrangement = (
        db.query(SeatingArrangement)
        .filter(SeatingArrangement.id == arrangement_id, SeatingArrangement.event_id == event.id)
        .options(
            joinedload(SeatingArrangement.seat_assignments)
            .joinedload(SeatAssignment.attendee),
            joinedload(SeatingArrangement.seat_assignments)
            .joinedload(SeatAssignment.table),
        )
        .first()
    )
    if not arrangement:
        raise HTTPException(status_code=404, detail="Seating arrangement not found")
    return arrangement


@router.patch("/{arrangement_id}", response_model=SeatingArrangementResponse)
def update_arrangement(
    arrangement_id: int,
    data: SeatingArrangementUpdate,
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    arrangement = db.query(SeatingArrangement).filter(
        SeatingArrangement.id == arrangement_id, SeatingArrangement.event_id == event.id
    ).first()
    if not arrangement:
        raise HTTPException(status_code=404, detail="Seating arrangement not found")
    if data.name is not None:
        arrangement.name = data.name
    db.commit()
    db.refresh(arrangement)
    return arrangement


@router.delete("/{arrangement_id}", status_code=204)
def delete_arrangement(
    arrangement_id: int,
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    arrangement = db.query(SeatingArrangement).filter(
        SeatingArrangement.id == arrangement_id, SeatingArrangement.event_id == event.id
    ).first()
    if not arrangement:
        raise HTTPException(status_code=404, detail="Seating arrangement not found")
    db.delete(arrangement)
    db.commit()


@router.post("/{arrangement_id}/seats", response_model=SeatAssignmentResponse, status_code=201)
def assign_seat(
    arrangement_id: int,
    data: SeatAssignmentCreate,
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    arrangement = db.query(SeatingArrangement).filter(
        SeatingArrangement.id == arrangement_id, SeatingArrangement.event_id == event.id
    ).first()
    if not arrangement:
        raise HTTPException(status_code=404, detail="Seating arrangement not found")

    existing = db.query(SeatAssignment).filter(
        SeatAssignment.arrangement_id == arrangement_id,
        SeatAssignment.attendee_id == data.attendee_id,
    ).first()
    if existing:
        existing.table_id = data.table_id
        existing.seat_number = data.seat_number
        db.commit()
        db.refresh(existing)
        return existing

    assignment = SeatAssignment(arrangement_id=arrangement_id, **data.model_dump())
    db.add(assignment)
    db.commit()
    db.refresh(assignment)
    return assignment


@router.delete("/{arrangement_id}/seats/{assignment_id}", status_code=204)
def remove_seat(
    arrangement_id: int,
    assignment_id: int,
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    assignment = db.query(SeatAssignment).filter(
        SeatAssignment.id == assignment_id, SeatAssignment.arrangement_id == arrangement_id
    ).first()
    if not assignment:
        raise HTTPException(status_code=404, detail="Seat assignment not found")
    db.delete(assignment)
    db.commit()


# ── Custom layout opt-in / opt-out ──────────────────────────────────────
#
# Per the 2026-05-20 refactor: by default every arrangement reads the
# shared event-default tables (those with arrangement_id IS NULL). When
# the user clicks "Use a different layout for this schedule item" on
# the Seating tab, this arrangement clones the event-default tables,
# diverges from then on, and edits stay local to it. "Reset to event
# default" deletes the clones and goes back to sharing.


@router.post("/{arrangement_id}/use-custom-layout", response_model=SeatingArrangementResponse)
def use_custom_layout(
    arrangement_id: int,
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    """Opt this arrangement out of the shared event layout. Clones every
    event-default table for this arrangement (so the canvas looks
    identical right after the click), remaps any existing seat
    assignments in this arrangement from the original tables to the
    clones, and flips `uses_custom_layout=True`.

    Idempotent — if the arrangement is already custom, returns it
    untouched.
    """
    arrangement = db.query(SeatingArrangement).filter(
        SeatingArrangement.id == arrangement_id,
        SeatingArrangement.event_id == event.id,
    ).first()
    if not arrangement:
        raise HTTPException(status_code=404, detail="Seating arrangement not found")

    if arrangement.uses_custom_layout:
        return arrangement  # already custom — nothing to do

    # Clone every event-default table (arrangement_id IS NULL) for this
    # arrangement. We track the old → new id mapping so existing seat
    # assignments can be repointed without losing the seating the user
    # already did in this arrangement.
    defaults = (
        db.query(Table)
        .filter(Table.event_id == event.id, Table.arrangement_id.is_(None))
        .all()
    )
    old_to_new: dict[int, int] = {}
    for src in defaults:
        clone = Table(
            event_id=src.event_id,
            arrangement_id=arrangement.id,
            name=src.name,
            shape=src.shape,
            width=src.width,
            height=src.height,
            capacity=src.capacity,
            x_position=src.x_position,
            y_position=src.y_position,
            rotation=src.rotation,
        )
        db.add(clone)
        db.flush()  # populate clone.id so we can record the mapping
        old_to_new[src.id] = clone.id

    # Remap seat_assignments in this arrangement from the old default
    # table ids to the new arrangement-scoped clones. Assignments
    # referencing a table that isn't in old_to_new (shouldn't happen,
    # but defensive) are left alone.
    if old_to_new:
        existing = (
            db.query(SeatAssignment)
            .filter(SeatAssignment.arrangement_id == arrangement.id)
            .all()
        )
        for sa in existing:
            if sa.table_id in old_to_new:
                sa.table_id = old_to_new[sa.table_id]

    arrangement.uses_custom_layout = True
    db.commit()
    db.refresh(arrangement)
    return arrangement


@router.post("/{arrangement_id}/reset-layout", response_model=SeatingArrangementResponse)
def reset_layout(
    arrangement_id: int,
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    """Opt this arrangement back into the shared event layout. Deletes
    every clone owned by this arrangement (which cascade-deletes the
    seat assignments referencing those clones — the user has to re-
    seat after a reset). Flips `uses_custom_layout=False`.

    Idempotent — already-default arrangements are returned untouched.
    """
    arrangement = db.query(SeatingArrangement).filter(
        SeatingArrangement.id == arrangement_id,
        SeatingArrangement.event_id == event.id,
    ).first()
    if not arrangement:
        raise HTTPException(status_code=404, detail="Seating arrangement not found")

    if not arrangement.uses_custom_layout:
        return arrangement  # already default — nothing to do

    # Delete this arrangement's custom tables. The Table → SeatAssignment
    # relationship has cascade="all, delete-orphan", so any seat
    # assignments pointing at these tables go with them. The user will
    # see an empty seating chart for this arrangement after reset and
    # can drag attendees in / auto-seat.
    clones = (
        db.query(Table)
        .filter(Table.event_id == event.id, Table.arrangement_id == arrangement.id)
        .all()
    )
    for clone in clones:
        db.delete(clone)

    arrangement.uses_custom_layout = False
    db.commit()
    db.refresh(arrangement)
    return arrangement
