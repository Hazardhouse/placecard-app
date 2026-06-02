"""
Tables router — arrangement-aware after the 2026-05-20 custom-layout
refactor.

Two flavours of table now coexist in the same `tables` table:

  * Event-default tables (arrangement_id IS NULL): the shared layout.
    Used by every arrangement that hasn't opted into a custom layout.
    99% of orders today.
  * Arrangement-scoped tables (arrangement_id == some arrangement.id):
    clones owned by that arrangement, created when the user clicks
    "Use a different layout for this schedule item" on the Seating tab.

Routing rules:
  * GET / POST / PATCH / DELETE all accept an optional `arrangement_id`
    query parameter.
  * When that arrangement is in custom mode (`uses_custom_layout=True`),
    ops are scoped to the arrangement's own table set.
  * When the arrangement is in default mode, OR when no
    arrangement_id is supplied, ops fall through to the event-default
    set (arrangement_id IS NULL).

That keeps the legacy single-canvas behavior intact for callers that
haven't been updated yet, while letting the new Seating tab work on
per-arrangement clones simply by passing the active arrangement's id.
"""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.event import Event
from app.models.seating import SeatingArrangement
from app.models.table import Table
from app.routers.events import get_user_event
from app.schemas.table import TableCreate, TableResponse, TableUpdate

router = APIRouter(prefix="/api/events/{event_id}/tables", tags=["tables"])


def _resolve_scope(
    event_id: int,
    arrangement_id: Optional[int],
    db: Session,
) -> Optional[int]:
    """Decide which `arrangement_id` filter to apply for table CRUD.

    Returns `None` to mean "operate on the event-default tables"
    (arrangement_id IS NULL). Returns a non-None int to mean "operate
    on this arrangement's own custom tables."

    Logic:
      * No arrangement_id query param → event default.
      * Arrangement provided AND it uses_custom_layout=True → that
        arrangement's clones.
      * Arrangement provided but it uses_custom_layout=False → fall
        back to event default. The arrangement just reads/writes the
        shared layout exactly as it did before the refactor.
      * Arrangement_id provided but doesn't exist / doesn't belong to
        this event → 404.
    """
    if arrangement_id is None:
        return None
    arr = (
        db.query(SeatingArrangement)
        .filter(
            SeatingArrangement.id == arrangement_id,
            SeatingArrangement.event_id == event_id,
        )
        .first()
    )
    if not arr:
        raise HTTPException(status_code=404, detail="Seating arrangement not found")
    return arr.id if arr.uses_custom_layout else None


@router.get("", response_model=List[TableResponse])
def list_tables(
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
    arrangement_id: Optional[int] = None,
):
    scope = _resolve_scope(event.id, arrangement_id, db)
    q = db.query(Table).filter(Table.event_id == event.id)
    if scope is None:
        q = q.filter(Table.arrangement_id.is_(None))
    else:
        q = q.filter(Table.arrangement_id == scope)
    return q.all()


@router.post("", response_model=TableResponse, status_code=201)
def create_table(
    data: TableCreate,
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
    arrangement_id: Optional[int] = None,
):
    scope = _resolve_scope(event.id, arrangement_id, db)
    table = Table(
        event_id=event.id,
        arrangement_id=scope,  # None when writing to the event default
        **data.model_dump(),
    )
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
    arrangement_id: Optional[int] = None,
):
    scope = _resolve_scope(event.id, arrangement_id, db)
    q = db.query(Table).filter(Table.id == table_id, Table.event_id == event.id)
    q = q.filter(Table.arrangement_id.is_(None)) if scope is None else q.filter(Table.arrangement_id == scope)
    table = q.first()
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
    arrangement_id: Optional[int] = None,
):
    scope = _resolve_scope(event.id, arrangement_id, db)
    q = db.query(Table).filter(Table.id == table_id, Table.event_id == event.id)
    q = q.filter(Table.arrangement_id.is_(None)) if scope is None else q.filter(Table.arrangement_id == scope)
    table = q.first()
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    db.delete(table)
    db.commit()
