from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class GoogleFormConnection(Base):
    __tablename__ = "google_form_connections"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"))
    form_id: Mapped[str] = mapped_column(String(255))
    form_title: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    field_mapping: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    credentials_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    event = relationship("Event", back_populates="google_form_connections")
