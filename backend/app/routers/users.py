from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import httpx
from ..auth import get_current_user
from ..config import settings

# Router-level auth dep — the invite endpoint forwards a Supabase
# service-role-key-authenticated request, so we cannot leave it
# accessible to anonymous callers (would let any visitor spam invites
# into your Supabase project).
router = APIRouter(
    prefix="/api/users",
    tags=["users"],
    dependencies=[Depends(get_current_user)],
)


class InviteRequest(BaseModel):
    email: str
    role: str = "Viewer"  # Admin, Editor, Viewer


@router.post("/invite")
async def invite_user(req: InviteRequest):
    if not settings.supabase_url or not settings.supabase_service_key:
        raise HTTPException(status_code=500, detail="Supabase not configured")

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{settings.supabase_url}/auth/v1/invite",
            headers={
                "apikey": settings.supabase_service_key,
                "Authorization": f"Bearer {settings.supabase_service_key}",
                "Content-Type": "application/json",
            },
            json={
                "email": req.email,
                "data": {"role": req.role},
            },
        )

    if resp.status_code >= 400:
        detail = resp.json().get("msg", resp.text)
        raise HTTPException(status_code=resp.status_code, detail=detail)

    return {"success": True, "email": req.email, "role": req.role}
