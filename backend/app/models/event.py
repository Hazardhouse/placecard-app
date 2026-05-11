from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    start_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    end_date: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    location: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    venue: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    venue_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    event_category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Two independent share tokens — one for the attendee list, one for the seating chart
    restaurant_share_token: Mapped[Optional[str]] = mapped_column(String(64), unique=True, index=True, nullable=True)
    seating_share_token: Mapped[Optional[str]] = mapped_column(String(64), unique=True, index=True, nullable=True)
    # Public event page token — auto-generated on create, served at /event/{token}
    public_token: Mapped[Optional[str]] = mapped_column(String(64), unique=True, index=True, nullable=True)
    # Optional event hero image — stored as a data URL ("data:image/jpeg;base64,...")
    # so we don't need separate file-storage infrastructure. Frontend resizes/
    # compresses before upload to keep this under ~100KB.
    image_data: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    attendees = relationship("Attendee", back_populates="event", cascade="all, delete-orphan")
    tables = relationship("Table", back_populates="event", cascade="all, delete-orphan")
    seating_arrangements = relationship("SeatingArrangement", back_populates="event", cascade="all, delete-orphan")
    google_form_connections = relationship("GoogleFormConnection", back_populates="event", cascade="all, delete-orphan")
    schedule_items = relationship("ScheduleItem", back_populates="event", cascade="all, delete-orphan")
    custom_forms = relationship("CustomForm", back_populates="event", cascade="all, delete-orphan")
