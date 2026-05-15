from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.event import Event
from app.models.schedule import ScheduleItem
from app.routers.events import get_user_event
from app.schemas.schedule import ScheduleItemCreate, ScheduleItemResponse, ScheduleItemUpdate

router = APIRouter(prefix="/api/events/{event_id}/schedule", tags=["schedule"])


@router.get("", response_model=List[ScheduleItemResponse])
def list_schedule(
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    return (
        db.query(ScheduleItem)
        .filter(ScheduleItem.event_id == event.id)
        .order_by(ScheduleItem.sort_order, ScheduleItem.start_time, ScheduleItem.created_at)
        .all()
    )


@router.post("", response_model=ScheduleItemResponse, status_code=201)
def create_schedule_item(
    data: ScheduleItemCreate,
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    item = ScheduleItem(event_id=event.id, **data.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.patch("/{item_id}", response_model=ScheduleItemResponse)
def update_schedule_item(
    item_id: int,
    data: ScheduleItemUpdate,
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    item = db.query(ScheduleItem).filter(
        ScheduleItem.id == item_id, ScheduleItem.event_id == event.id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Schedule item not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(item, key, value)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204)
def delete_schedule_item(
    item_id: int,
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    item = db.query(ScheduleItem).filter(
        ScheduleItem.id == item_id, ScheduleItem.event_id == event.id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Schedule item not found")
    db.delete(item)
    db.commit()
