from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.attendee import Attendee
from app.models.event import Event
from app.schemas.attendee import AttendeeCreate, AttendeeResponse, AttendeeUpdate

router = APIRouter(prefix="/api/events/{event_id}/attendees", tags=["attendees"])


@router.get("", response_model=List[AttendeeResponse])
def list_attendees(event_id: int, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return db.query(Attendee).filter(Attendee.event_id == event_id).order_by(Attendee.name).all()


@router.post("", response_model=AttendeeResponse, status_code=201)
def create_attendee(event_id: int, data: AttendeeCreate, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    attendee = Attendee(event_id=event_id, **data.model_dump())
    db.add(attendee)
    db.commit()
    db.refresh(attendee)
    return attendee


@router.get("/{attendee_id}", response_model=AttendeeResponse)
def get_attendee(event_id: int, attendee_id: int, db: Session = Depends(get_db)):
    attendee = db.query(Attendee).filter(
        Attendee.id == attendee_id, Attendee.event_id == event_id
    ).first()
    if not attendee:
        raise HTTPException(status_code=404, detail="Attendee not found")
    return attendee


@router.patch("/{attendee_id}", response_model=AttendeeResponse)
def update_attendee(
    event_id: int, attendee_id: int, data: AttendeeUpdate, db: Session = Depends(get_db)
):
    attendee = db.query(Attendee).filter(
        Attendee.id == attendee_id, Attendee.event_id == event_id
    ).first()
    if not attendee:
        raise HTTPException(status_code=404, detail="Attendee not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(attendee, key, value)
    db.commit()
    db.refresh(attendee)
    return attendee


@router.delete("/{attendee_id}", status_code=204)
def delete_attendee(event_id: int, attendee_id: int, db: Session = Depends(get_db)):
    attendee = db.query(Attendee).filter(
        Attendee.id == attendee_id, Attendee.event_id == event_id
    ).first()
    if not attendee:
        raise HTTPException(status_code=404, detail="Attendee not found")
    db.delete(attendee)
    db.commit()
