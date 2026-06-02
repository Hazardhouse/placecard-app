from typing import Optional

from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Table(Base):
    __tablename__ = "tables"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id"))
    # NULL = event-default table, shared across every arrangement that
    # hasn't opted into a custom layout. Non-NULL = a clone scoped to
    # exactly one arrangement (the one whose `uses_custom_layout` was
    # flipped true at clone time). See migration b8e4d7c2f6a3.
    arrangement_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("seating_arrangements.id", ondelete="SET NULL"),
        nullable=True, index=True,
    )
    name: Mapped[str] = mapped_column(String(100))
    shape: Mapped[str] = mapped_column(String(20), default="round")
    width: Mapped[float] = mapped_column(Float, default=120.0)
    height: Mapped[float] = mapped_column(Float, default=120.0)
    capacity: Mapped[int] = mapped_column(Integer, default=8)
    x_position: Mapped[float] = mapped_column(Float, default=0.0)
    y_position: Mapped[float] = mapped_column(Float, default=0.0)
    rotation: Mapped[float] = mapped_column(Float, default=0.0)

    event = relationship("Event", back_populates="tables")
    seat_assignments = relationship("SeatAssignment", back_populates="table", cascade="all, delete-orphan")
