from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.event import Event
from app.models.schedule import ScheduleItem
from app.schemas.schedule import ScheduleItemCreate, ScheduleItemResponse, ScheduleItemUpdate

router = APIRouter(prefix="/api/events/{event_id}/schedule", tags=["schedule"])


@router.get("", response_model=List[ScheduleItemResponse])
def list_schedule(event_id: int, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return (
        db.query(ScheduleItem)
        .filter(ScheduleItem.event_id == event_id)
        .order_by(ScheduleItem.sort_order, ScheduleItem.start_time, ScheduleItem.created_at)
        .all()
    )


@router.post("", response_model=ScheduleItemResponse, status_code=201)
def create_schedule_item(event_id: int, data: ScheduleItemCreate, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    item = ScheduleItem(event_id=event_id, **data.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=ScheduleItemResponse)
def update_schedule_item(event_id: int, item_id: int, data: ScheduleItemUpdate, db: Session = Depends(get_db)):
    item = db.query(ScheduleItem).filter(
        ScheduleItem.id == item_id, ScheduleItem.event_id == event_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Schedule item not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204)
def delete_schedule_item(event_id: int, item_id: int, db: Session = Depends(get_db)):
    item = db.query(ScheduleItem).filter(
        ScheduleItem.id == item_id, ScheduleItem.event_id == event_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Schedule item not found")
    db.delete(item)
    db.commit()
