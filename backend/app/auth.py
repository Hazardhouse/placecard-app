"""
Authentication dependency — verifies Supabase JWT tokens.

The frontend obtains JWTs from Supabase Auth when a user signs in, then
sends them on every API request as `Authorization: Bearer <token>`.
This module decodes those tokens, validates the signature against the
project's JWT secret, checks expiration and audience, and yields the
authenticated user's UUID for downstream queries.

Behaviour is governed by `settings.require_auth`:

    require_auth=False (default — local dev)
        The dependency returns a placeholder `AnonymousUser` so existing
        routes keep working without forcing every developer to set up a
        real Supabase session locally. Use this in dev or any
        environment where you explicitly accept unauthenticated calls.

    require_auth=True (production via Render env var)
        Every protected route demands a valid Bearer token. Missing,
        expired, or malformed tokens return 401. The user's UUID is
        available as `request.state.user_id` and as the dependency's
        return value.

To protect a route, declare the dependency:

    @router.get("/things")
    def list_things(user: CurrentUser = Depends(get_current_user)):
        return db.query(Thing).filter(Thing.owner_id == user.id).all()

Public routes (restaurant-share view, public event landing page) skip
the dependency entirely and rely on opaque tokens for access control.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings


# `auto_error=False` so the dependency can run in environments where
# auth is gated off (require_auth=False) and the Authorization header
# is genuinely absent.
_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthenticatedUser:
    """The user behind a request. `id` is the Supabase auth UUID."""
    id: str
    email: Optional[str] = None
    is_anonymous: bool = False


# Sentinel for unauthenticated requests when require_auth is off. Downstream
# code can `if user.is_anonymous: ...` to skip user-scoped filters during
# local dev. Production code should never see this — require_auth=true
# means an exception is raised before this is returned.
_ANONYMOUS = AuthenticatedUser(id="anonymous", is_anonymous=True)


def _credentials_error(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> AuthenticatedUser:
    """FastAPI dependency that yields the authenticated user.

    Raises HTTP 401 when require_auth is on and the token is missing,
    expired, or signed with the wrong secret.
    """
    if not settings.require_auth:
        # Dev / preview: accept everything. Routes that need a real
        # user ID should branch on `user.is_anonymous`.
        return _ANONYMOUS

    if creds is None or not creds.credentials:
        raise _credentials_error("Missing Authorization header")
    if not settings.supabase_jwt_secret:
        # Misconfiguration — fail loud rather than silently allow.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server is missing SUPABASE_JWT_SECRET",
        )

    try:
        # Supabase issues HS256-signed tokens. The `aud` claim is
        # "authenticated" for logged-in users.
        payload = jwt.decode(
            creds.credentials,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except jwt.ExpiredSignatureError:
        raise _credentials_error("Token has expired")
    except jwt.InvalidAudienceError:
        raise _credentials_error("Token audience is not 'authenticated'")
    except jwt.InvalidTokenError as exc:
        raise _credentials_error(f"Invalid token: {exc}") from exc

    user_id = payload.get("sub")
    if not user_id:
        raise _credentials_error("Token is missing 'sub' claim")

    user = AuthenticatedUser(
        id=user_id,
        email=payload.get("email"),
        is_anonymous=False,
    )
    # Stash on request.state so middleware (e.g. logging) can read it
    # without re-resolving the dependency.
    request.state.user_id = user_id
    return user


# Convenience type alias for route signatures. Importing this keeps the
# Depends(...) noise out of route definitions.
CurrentUser = AuthenticatedUser
