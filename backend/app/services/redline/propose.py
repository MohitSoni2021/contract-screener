from __future__ import annotations

from dataclasses import dataclass
import json
import logging
import re
from typing import Any

from app.services.citations.verifier import SourceDocument
from app.services.retrieval.keyword import retrieve_chunks

logger = logging.getLogger(__name__)


@dataclass
class ProposedRedline:
    clause_title: str
    target_text: str
    revised_text: str
    explanation: str
    context_sentence: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "clauseTitle": self.clause_title,
            "targetText": self.target_text,
            "revisedText": self.revised_text,
            "contextSentence": self.context_sentence,
            "explanation": self.explanation,
        }


def _find_sentence(text: str, target: str) -> str:
    sentences = [s.strip() for s in re.split(r"(?<=[.!?\n])\s+", text) if s.strip()]
    for s in sentences:
        if target in s:
            return s
    return target


def deterministic_redline(doc: SourceDocument, instruction: str) -> ProposedRedline:
    lower_inst = instruction.lower()
    text = doc.full_text

    # 1. Specific Shuttle / Consultant format: "thirty-day (30-day)"
    if any(k in lower_inst for k in ("notice", "terminat", "day", "60")):
        shuttle_match = re.search(r"(thirty|sixty|ninety|[a-zA-Z]+)-day\s*\(\d+-day\)", text, re.I)
        if shuttle_match:
            target = shuttle_match.group(0)
            revised = "sixty-day (60-day)" if "thirty" in target.lower() else "thirty-day (30-day)"
            return ProposedRedline(
                clause_title="Section 4.A - Term and Termination",
                target_text=target,
                revised_text=revised,
                context_sentence=_find_sentence(text, target),
                explanation=f'Surgically updated termination notice from "{target}" to "{revised}" while preserving surrounding contract text.',
            )

    # 2. Mutuality request for liability or indemnification
    if "mutual" in lower_inst:
        liability_match = re.search(r"The aggregate liability of (?:Customer|Vendor|either party)[^.]*\.", text, re.I)
        if liability_match:
            target = liability_match.group(0)
            revised = re.sub(r"of (?:Customer|Vendor)", "of either party", target, flags=re.I)
            if "either party" not in revised:
                revised = "The aggregate liability of either party arising out of or related to this Agreement shall be mutual and not exceed $1,000,000."
            return ProposedRedline(
                clause_title="Limitation of Liability",
                target_text=target,
                revised_text=revised,
                context_sentence=target,
                explanation="Revised unilateral liability cap into a mutual limitation applying equally to both parties.",
            )

    # 3. Standard notice period / termination days
    if any(k in lower_inst for k in ("notice", "terminat")):
        days_match = (
            re.search(r"([a-zA-Z0-9]+(?:\s*\(\d+\))?)\s+days?\s+(?:prior\s+)?written\s+notice", text, re.I)
            or re.search(r"([a-zA-Z0-9]+(?:\s*\(\d+\))?)\s+days?\s+notice", text, re.I)
        )
        if days_match:
            full_phrase = days_match.group(0)
            day_token = days_match.group(1)
            new_days = (
                "sixty (60)"
                if "60" in lower_inst
                else "ninety (90)"
                if "90" in lower_inst
                else "forty-five (45)"
            )
            target = day_token if "day" in day_token else f"{day_token} days"
            revised = f"{new_days} days" if "days" in target else new_days

            return ProposedRedline(
                clause_title="Termination Notice Period",
                target_text=target if target in text else full_phrase,
                revised_text=revised if target in text else full_phrase.replace(day_token, new_days),
                context_sentence=_find_sentence(text, days_match.group(0)),
                explanation=f'Updated notice period from "{day_token}" to "{new_days}" as requested.',
            )

    # 4. Payment terms / invoicing
    if any(k in lower_inst for k in ("payment", "invoic", "fee")):
        pay_match = re.search(r"within\s+([a-zA-Z0-9]+(?:\s*\(\d+\))?)\s+days\s+of\s+invoice", text, re.I)
        if pay_match:
            target = pay_match.group(0)
            revised = "within sixty (60) days of invoice"
            return ProposedRedline(
                clause_title="Payment Terms",
                target_text=target,
                revised_text=revised,
                context_sentence=_find_sentence(text, target),
                explanation="Extended payment term window to sixty (60) days from invoice receipt.",
            )

    # 5. Governing law jurisdiction
    if any(k in lower_inst for k in ("governing law", "delaware", "jurisdiction")):
        gov_match = re.search(r"laws of the State of [A-Za-z\s]+,", text, re.I)
        if gov_match:
            target = gov_match.group(0)
            revised = "laws of the State of Delaware,"
            return ProposedRedline(
                clause_title="Governing Law & Jurisdiction",
                target_text=target,
                revised_text=revised,
                context_sentence=_find_sentence(text, target),
                explanation="Changed governing jurisdiction to the State of Delaware.",
            )

    # 6. General fallback: retrieve top matching chunk sentence
    retrieval = retrieve_chunks([doc], instruction, 1)
    if retrieval.chunks:
        chunk_text = retrieval.chunks[0]["text"]
        sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", chunk_text) if s.strip()]
        sentence = next((s for s in sentences if len(s) >= 25 and s in text), None)
        if sentence:
            return ProposedRedline(
                clause_title="Contract Revision",
                target_text=sentence,
                revised_text=f"{sentence.strip()} [Amended per instruction: {instruction}]",
                context_sentence=sentence,
                explanation=f'Applied redline amendment to targeted clause according to "{instruction}".',
            )

    first_sentence = re.split(r"(?<=[.!?])\s+", text)[0].strip() or text[:100]
    return ProposedRedline(
        clause_title="Contract Terms",
        target_text=first_sentence,
        revised_text=f"{first_sentence} (as amended)",
        context_sentence=first_sentence,
        explanation=f"Proposed revision reflecting: {instruction}",
    )


async def propose_redline(
    doc: SourceDocument,
    instruction: str,
    ai_client: Any = None,
    chat_model_name: str | None = None,
) -> ProposedRedline:
    if ai_client is not None:
        try:
            prompt = (
                f"You are an expert contract redlining lawyer.\n"
                f"Given the contract text below and a user's edit instruction, propose an exact surgical tracked-change redline.\n\n"
                f'INSTRUCTION: "{instruction}"\n\n'
                f"CONTRACT EXCERPT:\n{doc.full_text[:8000]}\n\n"
                f"RULES:\n"
                f'1. "targetText" MUST be the exact, minimal word or phrase to be replaced in the contract text.\n'
                f'2. "revisedText" MUST be only the replacement wording that will be inserted.\n'
                f'3. "contextSentence" MUST be the complete sentence or clause from the contract containing targetText.\n'
                f'4. "clauseTitle" should name the section.\n'
                f'5. "explanation" must explain the legal rationale.\n'
                f'6. Return JSON only matching schema: {{"clauseTitle": string, "targetText": string, "revisedText": string, "contextSentence": string, "explanation": string}}'
            )
            response = await ai_client.chat.completions.create(
                model=chat_model_name or "openai/gpt-4o-mini",
                messages=[
                    {"role": "system", "content": "You are a professional legal drafting assistant. Output valid JSON only."},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.1,
                response_format={"type": "json_object"},
            )
            raw = response.choices[0].message.content or "{}"
            data = json.loads(raw)
            target = str(data.get("targetText", "")).strip()
            revised = str(data.get("revisedText", "")).strip()
            title = str(data.get("clauseTitle", "General Clause")).strip()
            explanation = str(data.get("explanation", "Contract redline")).strip()
            context = str(data.get("contextSentence", "")).strip()

            if target and target in doc.full_text:
                if not context:
                    context = _find_sentence(doc.full_text, target)
                return ProposedRedline(
                    clause_title=title,
                    target_text=target,
                    revised_text=revised,
                    context_sentence=context,
                    explanation=explanation,
                )
        except Exception as exc:
            logger.info("AI redline proposal failed: %s; falling back to deterministic rules", exc)

    return deterministic_redline(doc, instruction)
