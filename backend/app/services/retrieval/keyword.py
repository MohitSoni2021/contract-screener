from __future__ import annotations

from dataclasses import dataclass
import math
import re
from typing import Any

from app.services.citations.verifier import SourceDocument
from app.services.retrieval.chunker import chunk_document

STOP_WORDS = {
    "the", "and", "for", "are", "was", "what", "which", "who", "how", "does", "this", "that",
    "with", "from", "have", "has", "any", "all", "under", "into", "about", "between", "their",
    "there", "when", "where", "shall", "may", "can", "will", "contract", "agreement",
}


@dataclass
class RetrievedChunk:
    document_id: str
    text: str
    start_offset: int
    end_offset: int
    page_start: int
    page_end: int
    score: float

    def to_dict(self) -> dict[str, Any]:
        return {
            "document_id": self.document_id,
            "documentId": self.document_id,
            "text": self.text,
            "start_offset": self.start_offset,
            "startOffset": self.start_offset,
            "end_offset": self.end_offset,
            "endOffset": self.end_offset,
            "page_start": self.page_start,
            "pageStart": self.page_start,
            "page_end": self.page_end,
            "pageEnd": self.page_end,
            "score": self.score,
        }


@dataclass
class RetrievalCoverage:
    document_id: str
    chunks_retrieved: int
    chunks_total: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "document_id": self.document_id,
            "documentId": self.document_id,
            "chunks_retrieved": self.chunks_retrieved,
            "chunksRetrieved": self.chunks_retrieved,
            "chunks_total": self.chunks_total,
            "chunksTotal": self.chunks_total,
        }


@dataclass
class RetrievalResult:
    chunks: list[dict[str, Any]]
    coverage: list[dict[str, Any]]


def tokenize(query: str) -> list[str]:
    section_tokens: list[str] = []
    sec_regex = re.compile(r"\b(?:sec(?:tion)?\s+)?(\d{1,3}(?:\s*\([a-z0-9]+\))?)(?!\w)", re.I)
    for m in sec_regex.finditer(query):
        raw = re.sub(r"\s+", "", m.group(1)).lower()
        if raw:
            section_tokens.append(raw)
            section_tokens.append(f"sec {raw}")
            section_tokens.append(f"section {raw}")

    raw_words = re.findall(r"[a-z0-9]+(?:\([a-z0-9]+\))?|[a-z0-9$%]+", query.lower())
    words = [t for t in raw_words if (len(t) > 2 or any(c.isdigit() for c in t)) and t not in STOP_WORDS]
    seen = set()
    result = []
    for token in section_tokens + words:
        if token not in seen:
            seen.add(token)
            result.append(token)
    return result


def retrieve_chunks(
    docs: list[SourceDocument],
    query: str,
    per_document: int = 6,
    precomputed_chunks: dict[str, list[dict[str, Any]]] | None = None,
) -> RetrievalResult:
    terms = tokenize(query)
    all_chunks: list[dict[str, Any]] = []
    all_coverage: list[dict[str, Any]] = []

    for doc in docs:
        raw_chunks = (
            precomputed_chunks.get(doc.id)
            if precomputed_chunks and doc.id in precomputed_chunks
            else [c.to_dict() for c in chunk_document(doc.full_text, doc.pages)]
        )
        scored = []
        for chunk in raw_chunks:
            cleaned_text = re.sub(r"YES Academy[^\n]*\n[^\n]*", "", chunk["text"], flags=re.I)
            lower = cleaned_text.lower()
            distinct_hits = 0
            score = 0.0
            for term in terms:
                hits = lower.count(term)
                if hits > 0:
                    distinct_hits += 1
                    is_section = "(" in term or term.startswith("sec")
                    score += (15.0 if is_section else 1.0) + math.log(hits + 1)
            score += distinct_hits * 4.0
            if score > 0:
                scored.append({**chunk, "document_id": doc.id, "documentId": doc.id, "score": score})

        scored.sort(key=lambda c: c["score"], reverse=True)
        chosen = scored[:per_document]
        all_chunks.extend(chosen)
        all_coverage.append(
            RetrievalCoverage(
                document_id=doc.id,
                chunks_retrieved=len(chosen),
                chunks_total=len(raw_chunks),
            ).to_dict()
        )

    return RetrievalResult(chunks=all_chunks, coverage=all_coverage)
