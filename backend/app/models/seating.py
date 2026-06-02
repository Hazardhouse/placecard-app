from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class SeatingArrangement(Base):
    __tablename__ = "seating_arrangements"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"))
    name: Mapped[str] = mapped_column(String(255))
    # Flips to True when the user opts THIS arrangement out of the
    # shared event-default table layout via the Seating tab's
    # "Use a different layout for this schedule item" button. While
    # False (the default), the canvas reads from tables where
    # arrangement_id IS NULL. While True, tables where
    # arrangement_id == this.id are shown — those tables started as
    # a clone of the event defaults at opt-in time.
    uses_custom_layout: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    event = relationship("Event", back_populates="seating_arrangements")
    seat_assignments = relationship("SeatAssignment", back_populates="arrangement", cascade="all, delete-orphan")


class SeatAssignment(Base):
    __tablename__ = "seat_assignments"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    arrangement_id: Mapped[int] = mapped_column(ForeignKey("seating_arrangements.id"))
    attendee_id: Mapped[int] = mapped_column(ForeignKey("attendees.id"))
    table_id: Mapped[int] = mapped_column(ForeignKey("tables.id"))
    seat_number: Mapped[int] = mapped_column(Integer)

    arrangement = relationship("SeatingArrangement", back_populates="seat_assignments")
    attendee = relationship("Attendee", back_populates="seat_assignments")
    table = relationship("Table", back_populates="seat_assignments")
