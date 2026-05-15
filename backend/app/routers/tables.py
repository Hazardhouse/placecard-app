from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.event import Event
from app.models.table import Table
from app.routers.events import get_user_event
from app.schemas.table import TableCreate, TableResponse, TableUpdate

router = APIRouter(prefix="/api/events/{event_id}/tables", tags=["tables"])


@router.get("", response_model=List[TableResponse])
def list_tables(
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    return db.query(Table).filter(Table.event_id == event.id).all()


@router.post("", response_model=TableResponse, status_code=201)
def create_table(
    data: TableCreate,
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    table = Table(event_id=event.id, **data.model_dump())
    db.add(table)
    db.commit()
    db.refresh(table)
    return table


@router.patch("/{table_id}", response_model=TableResponse)
def update_table(
    table_id: int,
    data: TableUpdate,
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    table = db.query(Table).filter(Table.id == table_id, Table.event_id == event.id).first()
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    for key, value in data.model_dump(exclude_unset=True).items():
        setattr(table, key, value)
    db.commit()
    db.refresh(table)
    return table


@router.delete("/{table_id}", status_code=204)
def delete_table(
    table_id: int,
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    table = db.query(Table).filter(Table.id == table_id, Table.event_id == event.id).first()
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    db.delete(table)
    db.commit()
