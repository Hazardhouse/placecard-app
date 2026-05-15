from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Attendee(Base):
    __tablename__ = "attendees"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"))
    name: Mapped[str] = mapped_column(String(255))
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    dietary_requirements: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    responses: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    country: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    rsvp_status: Mapped[str] = mapped_column(String(20), default="pending")
    google_form_response_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    # Set when the guest clicks the unsubscribe link in any reminder email.
    # Suppresses all future event reminder emails for this attendee
    # without affecting their marketing subscription (which lives on
    # `email_subscribers`).
    email_unsubscribed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    event = relationship("Event", back_populates="attendees")
    seat_assignments = relationship("SeatAssignment", back_populates="attendee", cascade="all, delete-orphan")
