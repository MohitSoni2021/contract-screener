from __future__ import annotations

from dataclasses import dataclass, field
import json
import logging
import re
from typing import Any

from app.services.citations.verifier import (
    OffsetRange,
    SourceDocument,
    VerifiedCitation,
    verify_quote,
)
from app.services.retrieval.keyword import RetrievalCoverage, retrieve_chunks
from app.services.ai.prompts import (
    ANSWER_SYSTEM_PROMPT,
    build_answer_prompt,
    build_evidence,
)
from app.services.ai.synthesis import synthesize_legal_answer

logger = logging.getLogger(__name__)

INSUFFICIENT_PREFIX = "I could not verify this from the retrieved document evidence."


class AiOutputError(Exception):
    pass


@dataclass
class ModelAnswer:
    answer: str
    insufficient_evidence: bool = False
    citations: list[dict[str, str]] = field(default_factory=list)


@dataclass
class AnswerResult:
    answer: str
    insufficient_evidence: bool
    citations: list[VerifiedCitation]
    rejected_citation_count: int
    unverified: bool
    coverage: list[dict[str, Any]]

    def to_dict(self) -> dict[str, Any]:
        return {
            "answer": self.answer,
            "insufficientEvidence": self.insufficient_evidence,
            "citations": [c.to_dict() for c in self.citations],
            "rejectedCitationCount": self.rejected_citation_count,
            "unverified": self.unverified,
            "coverage": self.coverage,
        }


def parse_model_answer(raw: str) -> ModelAnswer:
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    try:
        data = json.loads(cleaned)
    except Exception as exc:
        raise AiOutputError("The AI returned an answer in an unexpected format.") from exc

    if not isinstance(data, dict):
        raise AiOutputError("The AI returned an answer in an unexpected format.")

    answer = str(data.get("answer", "")).strip()
    insufficient = bool(data.get("insufficientEvidence", False))
    raw_citations = data.get("citations") or []
    citations = []
    if isinstance(raw_citations, list):
        for item in raw_citations:
            if isinstance(item, dict) and "quote" in item:
                citations.append({
                    "documentId": str(item.get("documentId") or item.get("document_id") or ""),
                    "quote": str(item["quote"]),
                })
    return ModelAnswer(answer=answer, insufficient_evidence=insufficient, citations=citations)


def finalize_answer(
    parsed: ModelAnswer,
    docs: list[SourceDocument],
    coverage: list[dict[str, Any]],
    prefer_ranges: dict[str, list[OffsetRange]] | None = None,
) -> AnswerResult:
    by_id = {d.id: d for d in docs}
    citations: list[VerifiedCitation] = []
    seen = set()
    rejected = 0
    ranges_map = prefer_ranges or {}

    for candidate in parsed.citations:
        doc_id = candidate["documentId"] or (docs[0].id if len(docs) == 1 else "")
        doc = by_id.get(doc_id)
        if not doc:
            rejected += 1
            continue
        res = verify_quote(doc, candidate["quote"], ranges_map.get(doc.id))
        if not res.verified or not res.citation:
            rejected += 1
            continue
        key = f"{res.citation.document_id}:{res.citation.start_offset}:{res.citation.end_offset}"
        if key not in seen:
            seen.add(key)
            citations.append(res.citation)

    final_answer = parsed.answer
    if parsed.insufficient_evidence and not final_answer.startswith(INSUFFICIENT_PREFIX):
        final_answer = f"{INSUFFICIENT_PREFIX} {final_answer}"

    return AnswerResult(
        answer=final_answer,
        insufficient_evidence=parsed.insufficient_evidence,
        citations=citations,
        rejected_citation_count=rejected,
        unverified=not parsed.insufficient_evidence and len(citations) == 0,
        coverage=coverage,
    )


async def answer_question(
    question: str,
    docs: list[SourceDocument],
    ai_client: Any = None,
    chat_model_name: str | None = None,
) -> AnswerResult:
    retrieval = retrieve_chunks(docs, question)
    chunks = retrieval.chunks
    coverage = retrieval.coverage

    ranges: dict[str, list[OffsetRange]] = {}
    for c in chunks:
        doc_id = c["document_id"]
        ranges.setdefault(doc_id, []).append(
            OffsetRange(start=c["start_offset"], end=c["end_offset"])
        )

    if ai_client is not None:
        try:
            evidence = build_evidence(docs, chunks)
            prompt = build_answer_prompt(question, docs, evidence)
            response = await ai_client.chat.completions.create(
                model=chat_model_name or "openai/gpt-4o-mini",
                messages=[
                    {"role": "system", "content": ANSWER_SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.1,
                response_format={"type": "json_object"},
            )
            raw = response.choices[0].message.content or "{}"
            parsed = parse_model_answer(raw)
            return finalize_answer(parsed, docs, coverage, ranges)
        except Exception as exc:
            logger.info("AI provider failed or not configured, falling back to legal synthesis: %s", exc)

    fallback_dict = synthesize_legal_answer(question, docs)
    parsed = ModelAnswer(
        answer=fallback_dict["answer"],
        insufficient_evidence=fallback_dict.get("insufficientEvidence", False),
        citations=fallback_dict.get("citations", []),
    )
    return finalize_answer(parsed, docs, coverage, ranges)
