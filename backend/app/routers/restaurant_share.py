"""
Restaurant share link — generates a public, read-only view that can be shared
with a caterer/restaurant without giving them login access.

Two variants:
  - "attendees": a flat guest list with dietary breakdown (no contact info)
  - "seating":   the seating chart showing tables, seats, and each guest's diet

Each event stores an independent token per variant, so the organizer can share
one without exposing the other and rotate them independently.
"""

import logging
import secrets
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from app.config import settings
from app.database import get_db
from app.models.attendee import Attendee
from app.models.event import Event
from app.models.seating import SeatingArrangement, SeatAssignment
from app.models.table import Table
from app.routers.events import get_user_event

logger = logging.getLogger("restaurant_share")

router = APIRouter(tags=["restaurant_share"])

Variant = Literal["attendees", "seating"]


# ────────────────────────────────────────────────────────────────────────────
# Schemas
# ────────────────────────────────────────────────────────────────────────────

class RestaurantShareLink(BaseModel):
    variant: Variant
    share_token: Optional[str]
    share_url: Optional[str]


class RestaurantShareSendRequest(BaseModel):
    emails: List[str]
    organizer_name: str
    organizer_email: Optional[str] = None
    message: Optional[str] = None


class RestaurantShareSendResponse(BaseModel):
    sent: List[str]
    failed: List[str]
    share_url: str


class RestaurantAttendee(BaseModel):
    name: str
    dietary: Optional[str]


class DietaryCount(BaseModel):
    label: str
    icon: str
    count: int


class SeatEntry(BaseModel):
    seat_number: int
    attendee_name: Optional[str]
    dietary: Optional[str]


class SeatingTable(BaseModel):
    id: int
    name: str
    shape: Optional[str]
    capacity: int
    seats: List[SeatEntry]
    # Spatial layout — exposed so the public restaurant view can render
    # a visual floor plan that mirrors the SeatingBoard the organizer
    # arranged internally. All in the same coordinate space the
    # SeatingBoard uses (pixels, top-left origin).
    x_position: float = 0.0
    y_position: float = 0.0
    width: float = 120.0
    height: float = 120.0
    rotation: float = 0.0


class MealCount(BaseModel):
    option: str  # e.g. "Salmon"
    count: int


class MealCourseTotals(BaseModel):
    course: str  # "Entree" | "Main" | "Dessert" | "Drink"
    totals: List[MealCount]


class MealVenueTotals(BaseModel):
    venue: str
    total_guests: int  # number of attendees who selected a meal at this venue
    courses: List[MealCourseTotals]


class SeatingArrangementView(BaseModel):
    id: int
    name: str
    tables: List[SeatingTable]
    # Aggregated meal counts across every seated attendee at this arrangement
    meal_totals: List[MealVenueTotals] = []


class RestaurantView(BaseModel):
    variant: Variant
    event_name: str
    event_date: Optional[str]
    event_location: Optional[str]
    total_attendees: int
    confirmed_count: int
    pending_count: int
    declined_count: int
    dietary_breakdown: List[DietaryCount]
    # Populated only when variant == "attendees"
    attendees: List[RestaurantAttendee] = []
    # Populated only when variant == "seating"
    arrangements: List[SeatingArrangementView] = []


# ────────────────────────────────────────────────────────────────────────────
# Dietary categorisation — mirrors the frontend logic so totals align
# ────────────────────────────────────────────────────────────────────────────

DIETARY_RULES = [
    ("Vegan",         "🌱", ["vegan", "végan"]),
    ("Vegetarian",    "🌿", ["vegetarian", "végétarien"]),
]
DIETARY_ADDONS = [
    ("Gluten-free",   "🌾", ["gluten-free", "gluten free", "sans gluten"]),
    ("No alcohol",    "🚫", ["no alcohol", "sans alcool"]),
    ("No pork",       "🐷", ["no pork", "porc"]),
    ("Dairy-free",    "🥛", ["dairy-free", "dairy free", "lactose", "sans lactose"]),
    ("Nut allergy",   "🥜", ["nut allergy", "no nuts", "peanut"]),
]
NO_REQUIREMENTS_LABEL = "No dietary requirements"
OTHER_LABEL = "Other dietary needs"


def _categorise(dietary: Optional[str]) -> List[tuple[str, str]]:
    if not dietary or not dietary.strip():
        return [(NO_REQUIREMENTS_LABEL, "✓")]
    lower = dietary.lower()
    results: List[tuple[str, str]] = []
    for label, icon, terms in DIETARY_RULES:
        if any(t in lower for t in terms):
            results.append((label, icon))
            break
    for label, icon, terms in DIETARY_ADDONS:
        if any(t in lower for t in terms):
            results.append((label, icon))
    if not results:
        results.append((OTHER_LABEL, "⚠️"))
    return results


def _dietary_breakdown(attendees: List[Attendee]) -> List[DietaryCount]:
    counts: dict[tuple[str, str], int] = {}
    for a in attendees:
        for label, icon in _categorise(a.dietary_requirements):
            counts[(label, icon)] = counts.get((label, icon), 0) + 1
    order = [
        NO_REQUIREMENTS_LABEL,
        "Vegetarian", "Vegan",
        "Gluten-free", "Dairy-free", "No pork", "No alcohol", "Nut allergy",
        OTHER_LABEL,
    ]
    def rank(label: str) -> int:
        return order.index(label) if label in order else len(order)
    return sorted(
        [DietaryCount(label=lbl, icon=ico, count=cnt) for (lbl, ico), cnt in counts.items()],
        key=lambda d: rank(d.label),
    )


# ────────────────────────────────────────────────────────────────────────────
# Token helpers
# ────────────────────────────────────────────────────────────────────────────

def _token_column(variant: Variant) -> str:
    return "restaurant_share_token" if variant == "attendees" else "seating_share_token"


def _url_path(variant: Variant) -> str:
    # Public URL format: /restaurant/attendees/{token} or /restaurant/seating/{token}
    return f"/restaurant/{variant}"


def _make_link(event: Event, variant: Variant) -> RestaurantShareLink:
    token = getattr(event, _token_column(variant))
    return RestaurantShareLink(
        variant=variant,
        share_token=token,
        share_url=f"{settings.frontend_url}{_url_path(variant)}/{token}" if token else None,
    )


# ────────────────────────────────────────────────────────────────────────────
# Authenticated: manage share tokens per variant
# ────────────────────────────────────────────────────────────────────────────

@router.get("/api/events/{event_id}/restaurant-link/{variant}", response_model=RestaurantShareLink)
def get_link(
    variant: Variant,
    event: Event = Depends(get_user_event),
):
    return _make_link(event, variant)


@router.post("/api/events/{event_id}/restaurant-link/{variant}", response_model=RestaurantShareLink)
def generate_link(
    variant: Variant,
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    setattr(event, _token_column(variant), secrets.token_urlsafe(32))
    db.commit()
    db.refresh(event)
    return _make_link(event, variant)


@router.delete("/api/events/{event_id}/restaurant-link/{variant}", status_code=204)
def revoke_link(
    variant: Variant,
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    setattr(event, _token_column(variant), None)
    db.commit()


@router.post("/api/events/{event_id}/restaurant-link/{variant}/send", response_model=RestaurantShareSendResponse)
def send_link(
    variant: Variant,
    data: RestaurantShareSendRequest,
    event: Event = Depends(get_user_event),
    db: Session = Depends(get_db),
):
    # Auto-generate the token for this variant if it doesn't exist yet
    if not getattr(event, _token_column(variant)):
        setattr(event, _token_column(variant), secrets.token_urlsafe(32))
        db.commit()
        db.refresh(event)

    token = getattr(event, _token_column(variant))
    share_url = f"{settings.frontend_url}{_url_path(variant)}/{token}"
    event_date = event.start_date.strftime("%B %d, %Y") if event.start_date else None

    from app.services.email import send_restaurant_share_email

    sent: List[str] = []
    failed: List[str] = []
    for raw in data.emails:
        email = raw.strip()
        if not email or "@" not in email:
            continue
        ok = send_restaurant_share_email(
            to_email=email,
            event_name=event.name,
            share_url=share_url,
            organizer_name=data.organizer_name,
            organizer_email=data.organizer_email or "",
            event_date=event_date,
            event_location=event.location,
            personal_message=data.message,
            variant=variant,
        )
        (sent if ok else failed).append(email)

    return RestaurantShareSendResponse(sent=sent, failed=failed, share_url=share_url)


# ────────────────────────────────────────────────────────────────────────────
# Public endpoints — no auth, variant is part of the URL
# ────────────────────────────────────────────────────────────────────────────

def _build_attendees_view(event: Event, attendees: List[Attendee]) -> RestaurantView:
    total = len(attendees)
    confirmed = sum(1 for a in attendees if (a.rsvp_status or "").lower() == "confirmed")
    pending   = sum(1 for a in attendees if (a.rsvp_status or "").lower() == "pending")
    declined  = sum(1 for a in attendees if (a.rsvp_status or "").lower() == "declined")
    return RestaurantView(
        variant="attendees",
        event_name=event.name,
        event_date=event.start_date.strftime("%B %d, %Y") if event.start_date else None,
        event_location=event.location,
        total_attendees=total,
        confirmed_count=confirmed,
        pending_count=pending,
        declined_count=declined,
        dietary_breakdown=_dietary_breakdown(attendees),
        attendees=[
            RestaurantAttendee(name=a.name, dietary=a.dietary_requirements or None)
            for a in attendees
        ],
    )


def _build_seating_view(event: Event, db: Session, attendees: List[Attendee]) -> RestaurantView:
    # Pull arrangements for this event with their seat assignments + attendee + table
    arrangements = (
        db.query(SeatingArrangement)
        .filter(SeatingArrangement.event_id == event.id)
        .options(
            joinedload(SeatingArrangement.seat_assignments).joinedload(SeatAssignment.attendee),
            joinedload(SeatingArrangement.seat_assignments).joinedload(SeatAssignment.table),
        )
        .order_by(SeatingArrangement.id)
        .all()
    )
    tables = db.query(Table).filter(Table.event_id == event.id).order_by(Table.id).all()
    table_by_id = {t.id: t for t in tables}

    arrangement_views: List[SeatingArrangementView] = []
    for arr in arrangements:
        # Group assignments by table
        by_table: dict[int, list[SeatAssignment]] = {}
        for sa in arr.seat_assignments:
            by_table.setdefault(sa.table_id, []).append(sa)

        table_views: List[SeatingTable] = []
        # Only emit tables that this arrangement actually uses (i.e. has at
        # least one seat_assignment for). Tables drawn at the event level
        # but unused by this arrangement are orphans from past edits and
        # would mislead the caterer about what to set up.
        for t in tables:
            seats_for_table = sorted(by_table.get(t.id, []), key=lambda s: s.seat_number)
            if not seats_for_table:
                continue
            occupied_seats = {s.seat_number for s in seats_for_table}
            seats: List[SeatEntry] = []
            for seat_num in range(1, t.capacity + 1):
                if seat_num in occupied_seats:
                    assn = next(s for s in seats_for_table if s.seat_number == seat_num)
                    seats.append(SeatEntry(
                        seat_number=seat_num,
                        attendee_name=assn.attendee.name if assn.attendee else None,
                        dietary=assn.attendee.dietary_requirements if assn.attendee else None,
                    ))
                else:
                    seats.append(SeatEntry(seat_number=seat_num, attendee_name=None, dietary=None))
            table_views.append(SeatingTable(
                id=t.id,
                name=t.name,
                shape=t.shape,
                capacity=t.capacity,
                seats=seats,
                x_position=t.x_position,
                y_position=t.y_position,
                width=t.width,
                height=t.height,
                rotation=t.rotation,
            ))
            _ = table_by_id  # quiet lint

        # ── Aggregate meal selections across attendees seated in this arrangement ──
        seated_attendee_ids = {sa.attendee_id for sa in arr.seat_assignments if sa.attendee_id}
        seated_attendees = [a for a in attendees if a.id in seated_attendee_ids]

        # { venue: { course_label: { option: count } } }
        meal_accumulator: dict[str, dict[str, dict[str, int]]] = {}
        # venue -> number of attendees who have a meal entry at that venue
        venue_guest_counts: dict[str, int] = {}

        COURSE_KEYS = [("entree", "Entree"), ("main", "Main"), ("dessert", "Dessert"), ("drink", "Drink")]

        for a in seated_attendees:
            meals = (a.responses or {}).get("meal_selections") if isinstance(a.responses, dict) else None
            if not isinstance(meals, list):
                continue
            for m in meals:
                if not isinstance(m, dict):
                    continue
                venue = str(m.get("venue") or "").strip() or "Unspecified venue"
                # Does this meal entry have any actual course selections?
                has_course = any(str(m.get(k) or "").strip() for k, _ in COURSE_KEYS)
                if not has_course:
                    continue
                meal_accumulator.setdefault(venue, {})
                venue_guest_counts[venue] = venue_guest_counts.get(venue, 0) + 1
                for key, label in COURSE_KEYS:
                    raw = m.get(key)
                    if raw is None:
                        continue
                    option = str(raw).strip()
                    if not option:
                        continue
                    meal_accumulator[venue].setdefault(label, {})
                    meal_accumulator[venue][label][option] = meal_accumulator[venue][label].get(option, 0) + 1

        meal_totals: List[MealVenueTotals] = []
        for venue, course_map in meal_accumulator.items():
            course_totals: List[MealCourseTotals] = []
            for _, label in COURSE_KEYS:
                options = course_map.get(label, {})
                if not options:
                    continue
                course_totals.append(MealCourseTotals(
                    course=label,
                    totals=[
                        MealCount(option=opt, count=cnt)
                        for opt, cnt in sorted(options.items(), key=lambda kv: (-kv[1], kv[0]))
                    ],
                ))
            meal_totals.append(MealVenueTotals(
                venue=venue,
                total_guests=venue_guest_counts.get(venue, 0),
                courses=course_totals,
            ))

        arrangement_views.append(SeatingArrangementView(
            id=arr.id,
            name=arr.name,
            tables=table_views,
            meal_totals=meal_totals,
        ))

    total = len(attendees)
    confirmed = sum(1 for a in attendees if (a.rsvp_status or "").lower() == "confirmed")
    pending   = sum(1 for a in attendees if (a.rsvp_status or "").lower() == "pending")
    declined  = sum(1 for a in attendees if (a.rsvp_status or "").lower() == "declined")

    return RestaurantView(
        variant="seating",
        event_name=event.name,
        event_date=event.start_date.strftime("%B %d, %Y") if event.start_date else None,
        event_location=event.location,
        total_attendees=total,
        confirmed_count=confirmed,
        pending_count=pending,
        declined_count=declined,
        dietary_breakdown=_dietary_breakdown(attendees),
        arrangements=arrangement_views,
    )


@router.get("/api/restaurant-view/{variant}/{share_token}", response_model=RestaurantView)
def get_restaurant_view(variant: Variant, share_token: str, db: Session = Depends(get_db)):
    col = _token_column(variant)
    event = db.query(Event).filter(getattr(Event, col) == share_token).first()
    if not event:
        raise HTTPException(status_code=404, detail="Share link not found or has been revoked")

    attendees = db.query(Attendee).filter(Attendee.event_id == event.id).order_by(Attendee.name).all()

    if variant == "attendees":
        return _build_attendees_view(event, attendees)
    else:
        return _build_seating_view(event, db, attendees)
