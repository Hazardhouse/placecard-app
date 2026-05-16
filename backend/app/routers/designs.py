from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
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
    # Newest first within each content_type so the My Designs gallery
    # shows the most recent generation at the top. The frontend can
    # hydrate state directly from this order without reversing.
    rows = (
        db.query(Design)
        .filter(Design.event_id == event.id)
        .order_by(Design.content_type, Design.design_index.desc())
        .all()
    )
    grouped: Dict[str, List[DesignPayload]] = {}
    for d in rows:
        grouped.setdefault(d.content_type, []).append(_to_payload(d))
    return grouped


@router.post("", response_model=List[DesignPayload])
def append_designs(
    data: ReplaceDesignsRequest,
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    """Append a set of newly-generated designs to the event's existing
    designs for the given content_type.

    Each new design gets a design_index that continues past the
    current max for this (event, content_type), so the chronological
    history is preserved and reload order is deterministic. The other
    content_types on the same event are untouched.

    This is the post-generation path — preserves all prior designs
    so a user can accumulate variations across multiple Gemini calls
    instead of losing the last set every time they click Create.
    """
    current_max = (
        db.query(func.max(Design.design_index))
        .filter(
            Design.event_id == event.id,
            Design.content_type == data.content_type,
        )
        .scalar()
    )
    start_idx = (current_max + 1) if current_max is not None else 0

    saved: List[Design] = []
    for offset, d in enumerate(data.designs):
        design = Design(
            event_id=event.id,
            content_type=data.content_type,
            design_index=start_idx + offset,
            image_b64=d.image_b64,
            mime_type=d.mime_type,
            description=d.description,
            views_json=[v.model_dump() for v in d.views] if d.views else None,
        )
        db.add(design)
        saved.append(design)
    db.commit()
    return [_to_payload(d) for d in saved]


@router.put("", response_model=List[DesignPayload])
def replace_designs(
    data: ReplaceDesignsRequest,
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    """Replace the entire set of designs for one content_type.

    Used for an explicit "clear and start over" flow (not currently
    surfaced in the UI). The post-generation path uses POST (append)
    instead; PUT remains here for completeness so a caller can wipe
    + repopulate atomically when needed.
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
