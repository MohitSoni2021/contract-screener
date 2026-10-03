from __future__ import annotations

import json
import logging
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from app.dependencies import AuthenticatedUser, get_current_user, get_database
from app.routers.chat import _canonical_text, _owned_ready_document
from app.services.ai_client import chat_model, create_ai_client
from app.services.citations.verifier import (
    SourceDocument,
    VerifiedCitation,
    verify_quote,
)
from app.services.comparison.compare import compare_contracts
from app.services.comparison.diff import diff_words
from app.services.retrieval.keyword import retrieve_chunks

router = APIRouter(prefix="/api/compare", tags=["compare"])
logger = logging.getLogger(__name__)


class CompareRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    left_document_id: str = Field(min_length=1, max_length=64, alias="leftDocumentId")
    right_document_id: str = Field(min_length=1, max_length=64, alias="rightDocumentId")


class CompareChatRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    left_document_id: str = Field(min_length=1, max_length=64, alias="leftDocumentId")
    right_document_id: str = Field(min_length=1, max_length=64, alias="rightDocumentId")
    question: str = Field(min_length=2, max_length=1000)


def generate_comparative_fallback(
    question: str,
    report: dict[str, Any],
    doc_left: SourceDocument,
    doc_right: SourceDocument,
) -> dict[str, Any]:
    citations: list[dict[str, str]] = []
    sections = report.get("sections") or []
    changed_sections = [s for s in sections if s.get("status") != "unchanged"]

    if not changed_sections:
        return {
            "answer": (
                f"Identical contract versions: Both {doc_left.name} and {doc_right.name} "
                f"contain identical clause language across all {report['summary']['totalSections']} analyzed sections. "
                "No material changes or risk deviations were detected."
            ),
            "insufficientEvidence": False,
            "citations": [],
        }

    lines = [
        "### Contract Comparison Analysis\n",
        (
            f"Across **{report['summary']['totalSections']} clauses** analyzed between **{doc_left.name}** (Version 1) "
            f"and **{doc_right.name}** (Version 2), **{report['summary']['modifiedCount']} clause(s)** have been modified.\n"
        ),
    ]

    for sec in changed_sections[:3]:
        lines.append(f"#### {sec['title']} ({sec['status'].upper()})")
        lines.append(f"• **Legal Risk:** {sec.get('riskLevel', 'Low')} ({sec.get('significance', 'low')} significance, favors {sec.get('favorsParty', 'Mutual')})")
        lines.append(f"• **Analysis:** {sec.get('explanation', '')}")

        left_txt = sec.get("leftText") or ""
        right_txt = sec.get("rightText") or ""
        if left_txt and right_txt:
            left_tokens, right_tokens, _ = diff_words(left_txt, right_txt)
            del_text = " ".join(t.text for t in left_tokens if t.op == "deleted").strip()
            ins_text = " ".join(t.text for t in right_tokens if t.op == "inserted").strip()
            if del_text:
                lines.append(f'• **Removed in Version 1:** ~~"{del_text[:160]}"~~')
                if del_text in left_txt:
                    citations.append({"documentId": doc_left.id, "quote": del_text})
            if ins_text:
                lines.append(f'• **Added in Version 2:** **"{ins_text[:160]}"**')
                if ins_text in right_txt:
                    citations.append({"documentId": doc_right.id, "quote": ins_text})
        lines.append("")

    return {
        "answer": "\n".join(lines).strip(),
        "insufficientEvidence": False,
        "citations": citations,
    }


@router.post("")
async def compare_endpoint(
    payload: CompareRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    database: Any = Depends(get_database),
) -> dict[str, Any]:
    if payload.left_document_id == payload.right_document_id:
        raise HTTPException(status_code=400, detail="Select two different documents to compare.")

    left_raw = await _owned_ready_document(database, user.id, payload.left_document_id)
    right_raw = await _owned_ready_document(database, user.id, payload.right_document_id)

    left_text = await _canonical_text(database, left_raw)
    right_text = await _canonical_text(database, right_raw)

    doc_left = SourceDocument(id=left_raw["document_id"], name=left_raw["filename"], full_text=left_text)
    doc_right = SourceDocument(id=right_raw["document_id"], name=right_raw["filename"], full_text=right_text)

    return compare_contracts(doc_left, doc_right)


@router.post("/chat")
async def compare_chat_endpoint(
    payload: CompareChatRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    database: Any = Depends(get_database),
) -> dict[str, Any]:
    if payload.left_document_id == payload.right_document_id:
        raise HTTPException(status_code=400, detail="Select two different documents to compare.")

    left_raw = await _owned_ready_document(database, user.id, payload.left_document_id)
    right_raw = await _owned_ready_document(database, user.id, payload.right_document_id)

    left_text = await _canonical_text(database, left_raw)
    right_text = await _canonical_text(database, right_raw)

    doc_left = SourceDocument(id=left_raw["document_id"], name=left_raw["filename"], full_text=left_text)
    doc_right = SourceDocument(id=right_raw["document_id"], name=right_raw["filename"], full_text=right_text)

    report = compare_contracts(doc_left, doc_right)
    retrieval = retrieve_chunks([doc_left, doc_right], payload.question, 4)
    chunks = retrieval.chunks

    changed_sections = [s for s in report.get("sections", []) if s.get("status") != "unchanged"]

    augmented_chunks = list(chunks)
    for sec in changed_sections:
        if sec.get("leftText"):
            augmented_chunks.append({
                "document_id": doc_left.id,
                "text": sec["leftText"],
            })
        if sec.get("rightText"):
            augmented_chunks.append({
                "document_id": doc_right.id,
                "text": sec["rightText"],
            })

    model_answer: dict[str, Any] | None = None
    ai_client = None
    try:
        ai_client = create_ai_client()
    except Exception:
        pass

    if ai_client is not None:
        try:
            diff_summaries = []
            for sec in changed_sections:
                detail = ""
                left_txt = sec.get("leftText") or ""
                right_txt = sec.get("rightText") or ""
                if left_txt and right_txt:
                    left_tok, right_tok, _ = diff_words(left_txt, right_txt)
                    del_text = " ".join(t.text for t in left_tok if t.op == "deleted").strip()
                    ins_text = " ".join(t.text for t in right_tok if t.op == "inserted").strip()
                    if del_text or ins_text:
                        detail = f'\n  - Prior language (V1): "{del_text[:300]}"\n  - Revised language (V2): "{ins_text[:300]}"'
                diff_summaries.append(
                    f'Clause: "{sec["title"]}" [{sec["status"].upper()}]\n'
                    f'  - Impact: {sec.get("explanation", "")} (Favors: {sec.get("favorsParty", "Mutual")}, Risk: {sec.get("riskLevel", "Low")}){detail}'
                )

            evidence_str = "\n\n".join(
                f"[Document {c['document_id']}]:\n{c['text'][:1200]}"
                for c in augmented_chunks[:6]
            )

            prompt = (
                "You are an expert contract comparison and redline assistant.\n"
                "Analyze the differences between the two contract versions regarding the user's question.\n\n"
                f'QUESTION: "{payload.question}"\n\n'
                f"COMPARISON SUMMARY:\n"
                f"Total clauses: {report['summary']['totalSections']}, Modified: {report['summary']['modifiedCount']}, "
                f"Added: {report['summary']['addedCount']}, Deleted: {report['summary']['deletedCount']}\n\n"
                f"DETECTED CLAUSE DIFFERENCES:\n{chr(10).join(diff_summaries) or 'No differences detected.'}\n\n"
                f"DOCUMENT EVIDENCE (EXACT TEXT FROM CONTRACTS):\n{evidence_str}\n\n"
                "RULES:\n"
                "1. Explain specifically how Version 1 and Version 2 differ, addressing the user's question.\n"
                "2. Clearly explain what language was removed in Version 1, what was added in Version 2, and the commercial significance.\n"
                "3. Every citation quote MUST be verbatim exact text from the respective document.\n"
                '4. Output valid JSON matching schema: {"answer": string, "insufficientEvidence": boolean, "citations": [{"documentId": string, "quote": string}]}'
            )

            response = await ai_client.chat.completions.create(
                model=chat_model(),
                messages=[
                    {"role": "system", "content": "You are a professional legal comparison assistant. Output valid JSON only."},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.1,
                response_format={"type": "json_object"},
            )
            raw = response.choices[0].message.content or "{}"
            model_answer = json.loads(raw)
        except Exception as exc:
            logger.info("Compare chat LLM call failed: %s; running fallback", exc)
        finally:
            if ai_client is not None:
                await ai_client.close()

    if model_answer is None or "answer" not in model_answer:
        model_answer = generate_comparative_fallback(payload.question, report, doc_left, doc_right)

    # Verify candidate quotes independently against their respective documents
    verified_citations: list[dict[str, Any]] = []
    doc_map = {doc_left.id: doc_left, doc_right.id: doc_right}

    for cand in model_answer.get("citations", []):
        d_id = cand.get("documentId") or cand.get("document_id") or ""
        doc = doc_map.get(d_id)
        if doc and "quote" in cand:
            v_res = verify_quote(doc, str(cand["quote"]))
            if v_res.verified and v_res.citation:
                verified_citations.append(v_res.citation.to_dict())

    return {
        "answer": model_answer.get("answer", ""),
        "insufficientEvidence": model_answer.get("insufficientEvidence", False),
        "citations": verified_citations,
        "leftDocumentName": doc_left.name,
        "rightDocumentName": doc_right.name,
        "summary": report["summary"],
    }
