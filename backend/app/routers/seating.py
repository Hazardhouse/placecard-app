from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models.event import Event
from app.models.seating import SeatAssignment, SeatingArrangement
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
