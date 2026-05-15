from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.attendee import Attendee
from app.models.event import Event
from app.routers.events import get_user_event
from app.schemas.attendee import AttendeeCreate, AttendeeResponse, AttendeeUpdate

router = APIRouter(prefix="/api/events/{event_id}/attendees", tags=["attendees"])


@router.get("", response_model=List[AttendeeResponse])
def list_attendees(
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    return db.query(Attendee).filter(Attendee.event_id == event.id).order_by(Attendee.name).all()


@router.post("", response_model=AttendeeResponse, status_code=201)
def create_attendee(
    data: AttendeeCreate,
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    attendee = Attendee(event_id=event.id, **data.model_dump())
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return attendee


@router.get("/{attendee_id}", response_model=AttendeeResponse)
def get_attendee(
    attendee_id: int,
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    attendee = db.query(Attendee).filter(
        Attendee.id == attendee_id, Attendee.event_id == event.id
    ).first()
    if not attendee:
        raise HTTPException(status_code=404, detail="Attendee not found")
    return attendee


@router.patch("/{attendee_id}", response_model=AttendeeResponse)
def update_attendee(
    attendee_id: int,
    data: AttendeeUpdate,
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    attendee = db.query(Attendee).filter(
        Attendee.id == attendee_id, Attendee.event_id == event.id
    ).first()
    if not attendee:
        raise HTTPException(status_code=404, detail="Attendee not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(attendee, key, value)
    db.commit()
    db.refresh(attendee)
    return attendee


@router.delete("/{attendee_id}", status_code=204)
def delete_attendee(
    attendee_id: int,
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    attendee = db.query(Attendee).filter(
        Attendee.id == attendee_id, Attendee.event_id == event.id
    ).first()
    if not attendee:
        raise HTTPException(status_code=404, detail="Attendee not found")
    db.delete(attendee)
    db.commit()
