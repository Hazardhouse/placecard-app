"""
PDF table extraction for attendee/guest list imports.

The frontend already handles CSV (plain text) and XLSX (SheetJS) entirely
client-side. PDFs need a real parser, so the upload comes here. We use
pdfplumber to walk every page, pull out tables, then run light content
inference on the columns to handle two common shapes:

  1. PDFs with a header row ("Name | Email" at the top).
  2. PDFs that are just data — no header — usually exported as plain
     text from spreadsheets, mail merges, or typed lists.

For the headerless case we infer column types by what's in the cells
(emails, phones, names) and assign canonical names accordingly. Frontend
maps those to the same fields it expects from CSV/XLSX uploads.

Response shape: `{ headers: [...], rows: [{ header: value, ... }, ...] }`.
"""
from __future__ import annotations

import io
import logging
import re
from typing import Any, List, Optional

import pdfplumber
from fastapi import APIRouter, File, HTTPException, UploadFile

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["document-import"])

MAX_PDF_BYTES = 10 * 1024 * 1024  # 10 MB — guest lists are tiny; bigger uploads
                                   # are almost always wrong-file mistakes.

EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
PHONE_RE = re.compile(r"^\+?[\d][\d\s\-\(\)]{6,}$")
NAME_RE = re.compile(r"^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s\-\'\.]{0,60}$")


def _normalize_header(h: Optional[str]) -> str:
    if h is None:
        return ""
    # Collapse newlines/whitespace and lowercase. PDF tables often have
    # headers like "Email\nAddress" — flatten those.
    return " ".join(h.split()).strip().lower()


def _normalize_cell(v: Any) -> str:
    if v is None:
        return ""
    return " ".join(str(v).split()).strip()


def _looks_like_email(s: str) -> bool:
    return bool(EMAIL_RE.match(s.strip()))


def _looks_like_phone(s: str) -> bool:
    s = s.strip()
    if not PHONE_RE.match(s):
        return False
    digits = sum(1 for c in s if c.isdigit())
    return digits >= 7  # short codes excluded; expecting real phone numbers


def _looks_like_name(s: str) -> bool:
    return bool(NAME_RE.match(s.strip()))


def _infer_column_type(values: List[str]) -> Optional[str]:
    """Return canonical column name based on cell contents, or None."""
    non_empty = [v for v in values if v.strip()]
    if not non_empty:
        return None
    n = len(non_empty)
    if sum(1 for v in non_empty if _looks_like_email(v)) / n > 0.5:
        return "email"
    if sum(1 for v in non_empty if _looks_like_phone(v)) / n > 0.5:
        return "phone"
    if sum(1 for v in non_empty if _looks_like_name(v)) / n > 0.7:
        return "name"
    return None


def _row_zero_is_header(row_zero: List[str], inferred_types: List[Optional[str]]) -> bool:
    """Heuristic: if any cell in row 0 doesn't match its column's inferred
    data type, row 0 is almost certainly a header row.

    e.g. Column type is "email" but row[0][i] is "Email Address" → header.
         Column type is "email" and row[0][i] is "tich@example.com" → data.
    """
    for cell, col_type in zip(row_zero, inferred_types):
        cell = cell.strip()
        if not cell:
            continue
        if col_type == "email" and not _looks_like_email(cell):
            return True
        if col_type == "phone" and not _looks_like_phone(cell):
            return True
    return False


def _default_position_name(idx: int) -> str:
    # Reasonable defaults for the typical 2-column "name | email" PDF.
    if idx == 0:
        return "name"
    if idx == 1:
        return "email"
    return f"col{idx + 1}"


def _build_headers(
    all_rows: List[List[str]],
) -> tuple[List[str], List[List[str]]]:
    """Decide whether the first row is a header or data, then return
    `(headers, data_rows)` ready to zip into result dicts."""
    if not all_rows:
        return [], []
    num_cols = max(len(r) for r in all_rows)
    # Pad any short rows so column-wise scans don't crash.
    padded = [r + [""] * (num_cols - len(r)) for r in all_rows]
    columns = [[r[i] for r in padded] for i in range(num_cols)]
    inferred = [_infer_column_type(col) for col in columns]

    if _row_zero_is_header(padded[0], inferred):
        headers = [_normalize_header(c) for c in padded[0]]
        # Backfill any header that came back blank with the inferred type
        # or position default — better than dropping that column entirely.
        headers = [
            h or inferred[i] or _default_position_name(i)
            for i, h in enumerate(headers)
        ]
        return headers, padded[1:]

    # No header row — synthesise one from inference + sensible defaults.
    headers = [
        inferred[i] or _default_position_name(i) for i in range(num_cols)
    ]
    return headers, padded


@router.post("/parse-pdf-table")
async def parse_pdf_table(file: UploadFile = File(...)) -> dict:
    """
    Extract tables from an uploaded PDF and return rows as
    `{ headers: [...], rows: [{ header: value, ... }, ...] }`.

    Handles both header-row PDFs and headerless lists by inferring column
    types from the data (email, phone, name) before deciding whether to
    treat row 0 as a label row.
    """
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="File must be a PDF")

    body = await file.read()
    if len(body) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="PDF exceeds 10 MB limit")
    if len(body) == 0:
        raise HTTPException(status_code=400, detail="PDF is empty")

    # Pool every row from every table on every page. Some PDFs split the
    # same logical table across pages with the structure repeated; others
    # have completely different shapes. We let the column-count match
    # decide what belongs together.
    pooled: List[List[str]] = []

    try:
        with pdfplumber.open(io.BytesIO(body)) as pdf:
            for page in pdf.pages:
                tables = page.extract_tables() or []
                for table in tables:
                    if not table:
                        continue
                    cleaned = [
                        [_normalize_cell(c) for c in row]
                        for row in table
                        if row and any(c is not None and str(c).strip() for c in row)
                    ]
                    pooled.extend(cleaned)
    except Exception as exc:  # pdfplumber raises a mix of error types
        logger.exception("Failed to parse PDF: %s", exc)
        raise HTTPException(status_code=400, detail="Could not read this PDF") from exc

    if not pooled:
        raise HTTPException(
            status_code=422,
            detail="No table rows found. pdfplumber couldn't detect a "
                   "table structure in this PDF — it may be image-only "
                   "or use plain-text columns without a real grid.",
        )

    headers, data_rows = _build_headers(pooled)

    rows: List[dict] = []
    for raw_row in data_rows:
        row = {h: cell for h, cell in zip(headers, raw_row) if h}
        if any(v for v in row.values()):
            rows.append(row)

    if not rows:
        raise HTTPException(
            status_code=422,
            detail=f"Found a table but no usable rows. Detected columns: "
                   f"{headers}",
        )

    return {"headers": headers, "rows": rows}
