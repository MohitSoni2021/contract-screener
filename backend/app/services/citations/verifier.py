from __future__ import annotations

from dataclasses import dataclass, field
import re
from typing import Any

from app.services.citations.locator import SourcePage, page_for_offset
from app.services.citations.normalizer import (
    NormalizedText,
    normalize_quote,
    normalize_with_map,
)

MIN_QUOTE_CHARS = 12
WHITESPACE_COLLAPSE_RE = re.compile(r"\s+")


@dataclass
class SourceDocument:
    id: str
    name: str
    full_text: str
    pages: list[SourcePage] = field(default_factory=list)


@dataclass(frozen=True)
class OffsetRange:
    start: int
    end: int


@dataclass
class VerifiedCitation:
    document_id: str
    document_name: str
    quote: str
    start_offset: int
    end_offset: int
    page_start: int
    page_end: int
    occurrences: int
    verified: bool = True
    source_id: str = ""
    chunk_id: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "document_id": self.document_id,
            "documentId": self.document_id,
            "document_name": self.document_name,
            "documentName": self.document_name,
            "quote": self.quote,
            "start_offset": self.start_offset,
            "startOffset": self.start_offset,
            "end_offset": self.end_offset,
            "endOffset": self.end_offset,
            "char_start": self.start_offset,
            "char_end": self.end_offset,
            "page_start": self.page_start,
            "pageStart": self.page_start,
            "page_end": self.page_end,
            "pageEnd": self.page_end,
            "page_number": self.page_start,
            "occurrences": self.occurrences,
            "verified": True,
            "source_id": self.source_id or f"S1",
            "chunk_id": self.chunk_id or f"chunk-{self.document_id}-{self.start_offset}",
        }


@dataclass
class VerificationResult:
    verified: bool
    citation: VerifiedCitation | None = None
    reason: str | None = None


_doc_cache: dict[int, NormalizedText] = {}


def _get_normalized_doc(doc: SourceDocument) -> NormalizedText:
    doc_hash = id(doc.full_text)
    cached = _doc_cache.get(doc_hash)
    if cached is None:
        cached = normalize_with_map(doc.full_text)
        _doc_cache[doc_hash] = cached
    return cached


def verify_quote(
    doc: SourceDocument,
    candidate_quote: str,
    prefer_ranges: list[OffsetRange] | None = None,
) -> VerificationResult:
    """Deterministic zero-trust quote verification.
    The model supplies only the quote text; the document, offsets and pages
    all come from stored application data. `prefer_ranges` only chooses between
    repeated occurrences, it can never make a missing quote verified.
    """
    needle = normalize_quote(candidate_quote)
    if len(needle) < MIN_QUOTE_CHARS:
        return VerificationResult(verified=False, reason="too_short")

    haystack = _get_normalized_doc(doc)
    starts: list[int] = []
    idx = haystack.text.find(needle)
    while idx != -1:
        starts.append(idx)
        idx = haystack.text.find(needle, idx + 1)

    if not starts:
        return VerificationResult(verified=False, reason="not_found")

    ranges: list[OffsetRange] = [
        OffsetRange(
            start=haystack.map[s],
            end=haystack.map[s + len(needle) - 1] + 1,
        )
        for s in starts
    ]

    chosen = ranges[0]
    if prefer_ranges:
        for r in ranges:
            if any(r.start < p.end and r.end > p.start for p in prefer_ranges):
                chosen = r
                break

    actual_quote = WHITESPACE_COLLAPSE_RE.sub(" ", doc.full_text[chosen.start : chosen.end]).strip()

    citation = VerifiedCitation(
        document_id=doc.id,
        document_name=doc.name,
        quote=actual_quote,
        start_offset=chosen.start,
        end_offset=chosen.end,
        page_start=page_for_offset(doc.pages, chosen.start),
        page_end=page_for_offset(doc.pages, max(chosen.start, chosen.end - 1)),
        occurrences=len(ranges),
        verified=True,
    )
    return VerificationResult(verified=True, citation=citation)
