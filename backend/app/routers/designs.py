from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.design import Design
from app.models.event import Event
from app.routers.events import get_user_event
from app.schemas.design import DesignPayload, DesignView, ReplaceDesignsRequest

router = APIRouter(prefix="/api/events/{event_id}/designs", tags=["designs"])


def _to_payload(d: Design) -> DesignPayload:
    """SQLAlchemy row → Pydantic. Re-typed the JSON views into model objects."""
    views: Optional[List[DesignView]] = None
    if d.views_json is not None:
        views = [DesignView(**v) for v in d.views_json]
    return DesignPayload(
        image_b64=d.image_b64,
        mime_type=d.mime_type,
        description=d.description,
        views=views,
    )


@router.get("", response_model=Dict[str, List[DesignPayload]])
def list_designs(
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    """Every saved design for the event, grouped by content_type.

    Response shape mirrors the frontend's `DesignsByType` so the page
    component can hydrate its state directly from this dict without
    transformation. Missing content_types simply aren't present in
    the response.
    """
    rows = (
        db.query(Design)
        .filter(Design.event_id == event.id)
        .order_by(Design.content_type, Design.design_index)
        .all()
    )
    grouped: Dict[str, List[DesignPayload]] = {}
    for d in rows:
        grouped.setdefault(d.content_type, []).append(_to_payload(d))
    return grouped


@router.put("", response_model=List[DesignPayload])
def replace_designs(
    data: ReplaceDesignsRequest,
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    """Replace the entire set of designs for one content_type.

    Mirrors the frontend's "latest generation overwrites previous"
    semantic — each new generation replaces the prior set for that
    content_type. Other content_types on the same event are untouched.
    """
    db.query(Design).filter(
        Design.event_id == event.id,
        Design.content_type == data.content_type,
    ).delete()

    saved: List[Design] = []
    for idx, d in enumerate(data.designs):
        design = Design(
            event_id=event.id,
            content_type=data.content_type,
            design_index=idx,
            image_b64=d.image_b64,
            mime_type=d.mime_type,
            description=d.description,
            views_json=[v.model_dump() for v in d.views] if d.views else None,
        )
        db.add(design)
        saved.append(design)
    db.commit()
    return [_to_payload(d) for d in saved]


@router.delete("", status_code=204)
def clear_designs(
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
    content_type: Optional[str] = Query(default=None),
):
    """Wipe saved designs. Pass `?content_type=X` to clear just one
    set; omit to clear every set on the event.
    """
    q = db.query(Design).filter(Design.event_id == event.id)
    if content_type:
        q = q.filter(Design.content_type == content_type)
    q.delete()
    db.commit()
