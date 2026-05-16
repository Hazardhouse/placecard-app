from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Design(Base):
    """A generated name-card / program design persisted for an event.

    Designs come from the NanoBanana (Gemini) image generator. Each
    call costs real Gemini budget, so we persist results here to
    survive navigation, refreshes, and revisits — without this table,
    every visit to the Collateral tab regenerates from scratch.

    Replace semantics: a fresh generation for the same
    (event_id, content_type) replaces the prior set. The frontend
    treats each (event, content_type) as a single set, not an
    accumulating gallery — see routers/designs.py replace_designs.
    """
    __tablename__ = "designs"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"))
    # 'tented-name-cards' | 'name-cards' | 'programs'
    content_type: Mapped[str] = mapped_column(String(40))
    # Position within the set (0..N-1). Sort key so designs reload in
    # the order they were generated.
    design_index: Mapped[int] = mapped_column(Integer)
    # The primary image (first view) as base64. Large — typically
    # 100-500KB per row. Migration to Supabase Storage is captured in
    # the launch checklist as a Phase 2 item.
    image_b64: Mapped[str] = mapped_column(Text)
    mime_type: Mapped[str] = mapped_column(String(50))
    # Multi-view designs (programs = Front + Back, tented = Front + Back)
    # carry their additional views here as a JSON array of
    # {image_b64, mime_type, label}. None when single-view.
    views_json: Mapped[Optional[list]] = mapped_column(JSON, nullable=True)
    description: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    event = relationship("Event", back_populates="designs")
