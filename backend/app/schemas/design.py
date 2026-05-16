from typing import List, Optional

from pydantic import BaseModel


class DesignView(BaseModel):
    image_b64: str
    mime_type: str
    label: Optional[str] = None


class DesignPayload(BaseModel):
    """Shape used on both input (POST/PUT — saving generated designs)
    and output (GET — loading saved designs).

    Matches the frontend `Design` type in components/CollateralTab.tsx
    so the same value can flow through generation → persistence →
    rendering without any transformation step.
    """
    image_b64: str
    mime_type: str
    description: Optional[str] = None
    views: Optional[List[DesignView]] = None


class ReplaceDesignsRequest(BaseModel):
    """PUT body — replaces all designs for the given (event, content_type).

    The other content_types on the event are untouched.
    """
    content_type: str
    designs: List[DesignPayload]
