"""
Authentication dependency — verifies Supabase JWT tokens.

Supports two Supabase JWT signing modes, auto-detected per request from
the JWT's `alg` header:

  HS256 (legacy shared secret)
    Validates against `settings.supabase_jwt_secret`. Used by older
    Supabase projects that haven't migrated to the new key system, and
    by short-lived legacy tokens still in flight after a rotation.

  ES256 / RS256 / EdDSA (asymmetric signing keys — current default)
    Validates against the public key fetched from the project's JWKS
    endpoint at `{settings.supabase_url}/auth/v1/.well-known/jwks.json`.
    PyJWKClient handles key rotation + caching internally; we just hold
    one process-wide instance via lru_cache.

The algorithm is read from the unverified header to route the request,
then re-asserted inside `jwt.decode`, so a malicious token can't
downgrade the verification path.

Behaviour gated by `settings.require_auth`:

    require_auth=False (default — local dev)
        Returns a placeholder `AnonymousUser` so existing routes keep
        working without forcing every developer to set up a real
        Supabase session locally. Use this in dev or any environment
        where you explicitly accept unauthenticated calls.

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
from functools import lru_cache
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings


# `auto_error=False` so the dependency can run in environments where
# auth is gated off (require_auth=False) and the Authorization header
# is genuinely absent.
_bearer = HTTPBearer(auto_error=False)

# Asymmetric algorithms we accept from Supabase's new signing-key system.
# ES256 is the current Supabase default (ECC P-256); RS256 + EdDSA are
# accepted in case a project rotates to a different curve/algorithm later.
_ASYMMETRIC_ALGS = {"ES256", "RS256", "EdDSA"}


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


@lru_cache(maxsize=1)
def _jwks_client() -> "jwt.PyJWKClient":
    """Cached JWKS client used for asymmetric JWT verification.

    PyJWKClient handles fetching the public keys from the well-known
    URL, caching them, and rotating when the key set changes. We hold
    one instance per process to avoid re-issuing the HTTP fetch on
    every request.
    """
    if not settings.supabase_url:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Server is missing SUPABASE_URL for JWKS lookup",
        )
    jwks_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
    return jwt.PyJWKClient(jwks_url)


def _verify_jwt(token: str) -> dict:
    """Decode + verify a Supabase JWT, routing on the `alg` header."""
    try:
        header = jwt.get_unverified_header(token)
    except jwt.InvalidTokenError as exc:
        raise _credentials_error(f"Invalid token header: {exc}") from exc

    alg = header.get("alg")

    if alg == "HS256":
        if not settings.supabase_jwt_secret:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Server is missing SUPABASE_JWT_SECRET",
            )
        return jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )

    if alg in _ASYMMETRIC_ALGS:
        try:
            signing_key = _jwks_client().get_signing_key_from_jwt(token).key
        except jwt.PyJWKClientError as exc:
            raise _credentials_error(f"JWKS lookup failed: {exc}") from exc
        return jwt.decode(
            token,
            signing_key,
            algorithms=[alg],
            audience="authenticated",
        )

    raise _credentials_error(f"Unsupported JWT algorithm: {alg!r}")


def get_current_user(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> AuthenticatedUser:
    """FastAPI dependency that yields the authenticated user.

    Raises HTTP 401 when require_auth is on and the token is missing,
    expired, or signed with a key we don't recognize.
    """
    if not settings.require_auth:
        # Dev / preview: accept everything. Routes that need a real
        # user ID should branch on `user.is_anonymous`.
        return _ANONYMOUS

    if creds is None or not creds.credentials:
        raise _credentials_error("Missing Authorization header")

    try:
        payload = _verify_jwt(creds.credentials)
    except HTTPException:
        # Already a properly-formed HTTPException (e.g. JWKS 500,
        # missing secret 500) — re-raise without rewrapping.
        raise
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
