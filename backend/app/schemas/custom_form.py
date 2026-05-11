from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel


class CustomFormFieldDefinition(BaseModel):
    id: str
    type: str  # text, dropdown, multiple_choice, checkbox, textarea
    label: str
    required: bool = False
    options: Optional[List[str]] = None
    placeholder: Optional[str] = None


class CustomFormCreate(BaseModel):
    title: str
    description: Optional[str] = None
    fields: List[CustomFormFieldDefinition] = []


class CustomFormUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    fields: Optional[List[CustomFormFieldDefinition]] = None
    is_active: Optional[bool] = None


class CustomFormResponse(BaseModel):
    id: int
    event_id: int
    title: str
    description: Optional[str]
    fields: List[dict]
    share_token: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class CustomFormPublicResponse(BaseModel):
    title: str
    description: Optional[str]
    fields: List[dict]
    event_name: str
    event_date: Optional[str]
    event_location: Optional[str]
    is_active: bool


class FormSubmissionCreate(BaseModel):
    name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    country: Optional[str] = None
    dietary_requirements: Optional[str] = None
    responses: Optional[Dict[str, str]] = None


class FormInvitationCreate(BaseModel):
    emails: List[str]


class FormInvitationResponse(BaseModel):
    id: int
    form_id: int
    email: str
    sent_at: Optional[datetime]
    status: str

    model_config = {"from_attributes": True}
