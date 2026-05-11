from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ScheduleItem(Base):
    __tablename__ = "schedule_items"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    event_id: Mapped[int] = mapped_column(Integer, ForeignKey("events.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    start_time: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    end_time: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    venue_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    venue_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    location: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    requires_seating: Mapped[bool] = mapped_column(Boolean, default=False)
    assigned_to: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    assign_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Meal options for this schedule item, shape:
    #   { entrees: string[], mains: string[], desserts: string[], drinks: string[] }
    # When any array is non-empty, this schedule item shows up as a selectable
    # venue in the attendee edit drawer's Meal Selection dropdown.
    meal_options: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    event = relationship("Event", back_populates="schedule_items")
