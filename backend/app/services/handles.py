"""
Handle normalization, validation, and auto-generation.

@handles live at the root of the URL path. They:
  - are stored case-preserving but treated case-insensitively
  - are normalized to NFKC + ASCII before storage to defeat lookalike
    Unicode squats (Cyrillic `а` masquerading as Latin `a` etc.)
  - must pass a curated reserved list (app/data/reserved_handles.json)
    and a profanity check (better-profanity)

Auto-generation lives here too: GET /api/profiles/me provisions a
profile lazily on first authenticated load, deriving the handle from
the user's display name. Conflicts get a numeric suffix.

The reserved JSON is loaded once at module import — re-load by
restarting the process. Cheap to do; the file is tiny.
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from typing import Iterable, Set

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.profile import Profile


_DATA_FILE = Path(__file__).resolve().parent.parent / "data" / "reserved_handles.json"


def _load_reserved() -> Set[str]:
    """Flatten the categorised reserved file into a single lowercase set.

    The JSON groups reserved words by category for human readability;
    matching is just "in the set", category doesn't affect behaviour.
    """
    try:
        with _DATA_FILE.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return set()
    out: Set[str] = set()
    categories = data.get("categories", {})
    for words in categories.values():
        for w in words:
            if isinstance(w, str):
                out.add(w.lower())
    return out


_RESERVED: Set[str] = _load_reserved()


# Strict format: starts with a letter, then letters/digits/dashes/underscores,
# 3–30 chars total, no leading/trailing separator, no consecutive separators.
# Each inner char is either an alnum or a separator followed by an alnum —
# the lookahead is what guarantees no trailing or repeated separator.
_FORMAT_RE = re.compile(r"^[a-z](?:[a-z0-9]|[-_](?=[a-z0-9])){2,29}$")


def normalize_handle(raw: str) -> str:
    """Canonical form used for storage and lookup.

    Steps:
      1. NFKC normalize to fold Unicode lookalikes / compatibility forms
      2. Decompose + drop non-ASCII (strips diacritics: é → e, ñ → n)
      3. Lowercase
      4. Trim whitespace
    """
    if not raw:
        return ""
    nfkc = unicodedata.normalize("NFKC", raw)
    ascii_only = (
        unicodedata.normalize("NFKD", nfkc)
        .encode("ascii", "ignore")
        .decode("ascii")
    )
    return ascii_only.strip().lower()


def is_valid_format(handle: str) -> bool:
    """Caller is expected to have run `normalize_handle` first."""
    return bool(_FORMAT_RE.fullmatch(handle))


def is_reserved(handle: str) -> bool:
    if handle in _RESERVED:
        return True
    # Profanity check via better-profanity. Import lazily so the module
    # still loads if the lib isn't installed yet (e.g. local dev before
    # `pip install`).
    try:
        from better_profanity import profanity
    except ImportError:
        return False
    return profanity.contains_profanity(handle)


def is_taken(db: Session, handle: str, *, exclude_user_id: str | None = None) -> bool:
    """Case-insensitive uniqueness check. Pass `exclude_user_id` when
    validating an edit so the user's own current handle doesn't count
    as a collision.
    """
    q = db.query(Profile).filter(func.lower(Profile.handle) == handle.lower())
    if exclude_user_id is not None:
        q = q.filter(Profile.user_id != exclude_user_id)
    return db.query(q.exists()).scalar() or False


def reason_unavailable(db: Session, handle: str, *, exclude_user_id: str | None = None) -> str | None:
    """Return the first human-readable reason `handle` can't be used,
    or None when it's free. Callers turn the reason into a 4xx detail.
    """
    if not handle:
        return "Handle is required."
    if not is_valid_format(handle):
        return (
            "Handles must be 3–30 characters, start with a letter, and contain "
            "only letters, numbers, dashes, or underscores."
        )
    if is_reserved(handle):
        return "That handle is reserved."
    if is_taken(db, handle, exclude_user_id=exclude_user_id):
        return "That handle is taken."
    return None


def slugify_for_handle(display_name: str) -> str:
    """Turn a display name into a handle base. Trims to leave room for
    a numeric suffix during conflict resolution.
    """
    base = normalize_handle(display_name)
    # Replace any run of non-[a-z0-9] with a single dash.
    base = re.sub(r"[^a-z0-9]+", "-", base)
    # Collapse runs of dashes, then trim leading/trailing.
    base = re.sub(r"-{2,}", "-", base).strip("-")
    # Leave room for "-99" suffix in the 30-char cap.
    base = base[:25] or "host"
    # Must start with a letter; if it starts with a digit, prefix "h-".
    if base and not base[0].isalpha():
        base = f"h-{base}"
    return base


def auto_generate_handle(db: Session, display_name: str) -> str:
    """Return an available handle derived from `display_name`.

    Strategy: slugify, then try base; on collision append -2, -3, … up
    to -99. After that, give up and append a 4-digit random hash —
    practically impossible to hit but worth a backstop.
    """
    base = slugify_for_handle(display_name)
    candidate = base
    if not is_reserved(candidate) and not is_taken(db, candidate):
        return candidate
    for n in range(2, 100):
        candidate = f"{base}-{n}"
        if is_reserved(candidate):
            continue
        if not is_taken(db, candidate):
            return candidate
    # Backstop: pseudo-random suffix derived from the user-supplied name
    # + the current row count — deterministic enough for tests, unique
    # enough in practice.
    import secrets
    return f"{base}-{secrets.token_hex(2)}"


def all_reserved() -> Iterable[str]:
    """For introspection / admin UIs. Returns a snapshot of the in-memory set."""
    return tuple(sorted(_RESERVED))
