import secrets
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models.attendee import Attendee
from app.models.custom_form import CustomForm, FormInvitation
from app.models.event import Event
from app.schemas.custom_form import (
    CustomFormCreate,
    CustomFormPublicResponse,
    CustomFormResponse,
    CustomFormUpdate,
    FormInvitationCreate,
    FormInvitationResponse,
    FormSubmissionCreate,
)

router = APIRouter(tags=["custom_forms"])


# ── Authenticated endpoints (admin) ──

@router.get("/api/events/{event_id}/forms", response_model=List[CustomFormResponse])
def list_forms(event_id: int, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return db.query(CustomForm).filter(CustomForm.event_id == event_id).all()


@router.post("/api/events/{event_id}/forms", response_model=CustomFormResponse, status_code=201)
def create_form(event_id: int, data: CustomFormCreate, db: Session = Depends(get_db)):
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    form = CustomForm(
        event_id=event_id,
        title=data.title,
        description=data.description,
        fields=[f.model_dump() for f in data.fields],
        share_token=secrets.token_urlsafe(32),
    )
    db.add(form)
    db.commit()
    db.refresh(form)
    return form


@router.get("/api/events/{event_id}/forms/{form_id}", response_model=CustomFormResponse)
def get_form(event_id: int, form_id: int, db: Session = Depends(get_db)):
    form = db.query(CustomForm).filter(
        CustomForm.id == form_id, CustomForm.event_id == event_id
    ).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    return form


@router.patch("/api/events/{event_id}/forms/{form_id}", response_model=CustomFormResponse)
def update_form(event_id: int, form_id: int, data: CustomFormUpdate, db: Session = Depends(get_db)):
    form = db.query(CustomForm).filter(
        CustomForm.id == form_id, CustomForm.event_id == event_id
    ).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    update_data = data.model_dump(exclude_unset=True)
    if "fields" in update_data and update_data["fields"] is not None:
        update_data["fields"] = [f.model_dump() if hasattr(f, "model_dump") else f for f in update_data["fields"]]
    for key, value in update_data.items():
        setattr(form, key, value)
    form.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(form)
    return form


@router.delete("/api/events/{event_id}/forms/{form_id}", status_code=204)
def delete_form(event_id: int, form_id: int, db: Session = Depends(get_db)):
    form = db.query(CustomForm).filter(
        CustomForm.id == form_id, CustomForm.event_id == event_id
    ).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    db.delete(form)
    db.commit()


@router.post("/api/events/{event_id}/forms/{form_id}/send", response_model=List[FormInvitationResponse])
def send_invitations(event_id: int, form_id: int, data: FormInvitationCreate, db: Session = Depends(get_db)):
    form = db.query(CustomForm).filter(
        CustomForm.id == form_id, CustomForm.event_id == event_id
    ).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    event = db.query(Event).filter(Event.id == event_id).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")

    from app.services.email import send_form_invitation

    form_url = f"{settings.frontend_url}/forms/{form.share_token}"
    event_date = event.start_date.strftime("%B %d, %Y") if event.start_date else None

    # Get organizer info from the request context (simplified — uses event name for now)
    organizer_name = "Your Event Organizer"
    organizer_email = ""

    results = []
    for email in data.emails:
        email = email.strip()
        if not email:
            continue

        invitation = FormInvitation(
            form_id=form.id,
            email=email,
        )

        success = send_form_invitation(
            to_email=email,
            event_name=event.name,
            form_url=form_url,
            organizer_name=organizer_name,
            organizer_email=organizer_email,
            event_date=event_date,
        )

        if success:
            invitation.status = "sent"
            invitation.sent_at = datetime.utcnow()
        else:
            invitation.status = "failed"

        db.add(invitation)
        results.append(invitation)

    db.commit()
    for inv in results:
        db.refresh(inv)
    return results


@router.get("/api/events/{event_id}/forms/{form_id}/invitations", response_model=List[FormInvitationResponse])
def list_invitations(event_id: int, form_id: int, db: Session = Depends(get_db)):
    form = db.query(CustomForm).filter(
        CustomForm.id == form_id, CustomForm.event_id == event_id
    ).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    return db.query(FormInvitation).filter(FormInvitation.form_id == form_id).all()


# ── Public endpoints (no auth required) ──

@router.get("/api/forms/{share_token}")
def get_public_form(share_token: str, db: Session = Depends(get_db)):
    form = db.query(CustomForm).filter(CustomForm.share_token == share_token).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")

    event = db.query(Event).filter(Event.id == form.event_id).first()

    return CustomFormPublicResponse(
        title=form.title,
        description=form.description,
        fields=form.fields,
        event_name=event.name if event else "Event",
        event_date=event.start_date.strftime("%B %d, %Y") if event and event.start_date else None,
        event_location=event.location if event else None,
        is_active=form.is_active,
    )


@router.post("/api/forms/{share_token}/submit", status_code=201)
def submit_form(share_token: str, data: FormSubmissionCreate, db: Session = Depends(get_db)):
    form = db.query(CustomForm).filter(CustomForm.share_token == share_token).first()
    if not form:
        raise HTTPException(status_code=404, detail="Form not found")
    if not form.is_active:
        raise HTTPException(status_code=400, detail="This form is no longer accepting responses")

    # Validate required custom fields
    for field in form.fields:
        if field.get("required") and field["id"] not in (data.responses or {}):
            raise HTTPException(
                status_code=422,
                detail=f"Required field '{field['label']}' is missing",
            )

    attendee = Attendee(
        event_id=form.event_id,
        name=data.name,
        email=data.email,
        phone=data.phone,
        country=data.country,
        dietary_requirements=data.dietary_requirements,
        responses=data.responses,
        rsvp_status="confirmed",
    )
    db.add(attendee)
    db.commit()
    db.refresh(attendee)

    return {"message": "Thank you! Your response has been submitted.", "attendee_id": attendee.id}
