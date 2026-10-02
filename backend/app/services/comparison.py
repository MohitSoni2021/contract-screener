from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any

from app.services.extraction import ExtractedDocument, SourceBlock

_WORD_RE = re.compile(r"\b[\w]+(?:[.,%/-][\w]+)*\b", re.UNICODE)
_NUMBER_RE = re.compile(r"(?:[$€£]\s?\d[\d,.]*|\d[\d,.]*\s?(?:%|percent|million|billion|days?|months?|years?))", re.I)
_SUBSTANTIVE_RE = re.compile(
    r"\b(?:liabilit(?:y|ies)|liable|cap(?:ped)?|limit(?:ation)?|indemn(?:ity|ify)|payment|fee|price|term|renew|terminat|notice|confidential|governing|jurisdiction|ownership|deliver|warrant|obligation|shall|must|may not)\b",
    re.I,
)


def _normalized(text: str) -> str:
    return " ".join(_WORD_RE.findall(text.lower()))


def _similarity(left: str, right: str) -> float:
    return SequenceMatcher(None, _normalized(left), _normalized(right)).ratio()


def _source(block: SourceBlock | None, document_id: str) -> dict[str, Any] | None:
    if block is None:
        return None
    return {
        "document_id": document_id,
        "text": block.text,
        "block_number": block.block_number,
        "page_number": block.page_number,
    }


def _plain_summary(old: str, new: str) -> str:
    old_numbers = _NUMBER_RE.findall(old)
    new_numbers = _NUMBER_RE.findall(new)
    if old_numbers != new_numbers and old_numbers and new_numbers:
        return f"The stated amount or timing changed from {old_numbers[0]} to {new_numbers[0]}."
    if re.search(r"\b(?:liabilit|liable|cap|limit)\b", old + " " + new, re.I):
        return "The liability allocation or liability cap changed and should be reviewed."
    return "The obligation or permission in this clause changed and should be reviewed."


def _classify(old: str, new: str) -> tuple[str, str, str]:
    if _normalized(old) == _normalized(new):
        return "formatting", "formatting", "Only formatting or whitespace changed."
    old_numbers = _NUMBER_RE.findall(old)
    new_numbers = _NUMBER_RE.findall(new)
    has_material_terms = _SUBSTANTIVE_RE.search(old) or _SUBSTANTIVE_RE.search(new)
    if old_numbers != new_numbers or (has_material_terms and _similarity(old, new) < 0.92):
        return "substantive", "substantive", _plain_summary(old, new)
    return "wording", "wording", "The wording changed without an apparent change to the commercial terms."


def _change(change_type: str, significance: str, summary: str, old: SourceBlock | None, new: SourceBlock | None, old_id: str, new_id: str) -> dict[str, Any]:
    return {
        "change_id": f"{old.block_number if old else 'new'}-{new.block_number if new else 'removed'}",
        "change_type": change_type,
        "significance": significance,
        "summary": summary,
        "old": _source(old, old_id),
        "new": _source(new, new_id),
    }


def compare_documents(old_document: ExtractedDocument, new_document: ExtractedDocument, old_document_id: str, new_document_id: str) -> list[dict[str, Any]]:
    old_blocks = old_document.blocks
    new_blocks = new_document.blocks
    matcher = SequenceMatcher(
        None,
        [block.text for block in old_blocks],
        [block.text for block in new_blocks],
        autojunk=False,
    )
    changes: list[dict[str, Any]] = []
    for tag, old_start, old_end, new_start, new_end in matcher.get_opcodes():
        if tag == "equal":
            for old_index, new_index in zip(range(old_start, old_end), range(new_start, new_end)):
                changes.append(_change("unchanged", "none", "No change.", old_blocks[old_index], new_blocks[new_index], old_document_id, new_document_id))
            continue
        old_slice = old_blocks[old_start:old_end]
        new_slice = new_blocks[new_start:new_end]
        if tag == "replace" and len(old_slice) == len(new_slice):
            old_texts = [_normalized(block.text) for block in old_slice]
            new_texts = [_normalized(block.text) for block in new_slice]
            if sorted(old_texts) == sorted(new_texts) and old_texts != new_texts:
                for old_block, new_block in zip(old_slice, new_slice):
                    changes.append(_change("moved", "wording", "This clause appears in a different position.", old_block, new_block, old_document_id, new_document_id))
                continue
        pair_count = min(len(old_slice), len(new_slice))
        for index in range(pair_count):
            change_type, significance, summary = _classify(old_slice[index].text, new_slice[index].text)
            changes.append(_change(change_type, significance, summary, old_slice[index], new_slice[index], old_document_id, new_document_id))
        for block in old_slice[pair_count:]:
            changes.append(_change("deleted", "substantive", "This clause or paragraph was removed.", block, None, old_document_id, new_document_id))
        for block in new_slice[pair_count:]:
            changes.append(_change("inserted", "substantive", "This clause or paragraph was added.", None, block, old_document_id, new_document_id))

    deleted = [change for change in changes if change["change_type"] == "deleted"]
    inserted = [change for change in changes if change["change_type"] == "inserted"]
    for removed in deleted:
        for added in inserted:
            if _similarity(removed["old"]["text"], added["new"]["text"]) >= 0.96:
                removed["change_type"] = added["change_type"] = "moved"
                removed["significance"] = added["significance"] = "wording"
                removed["summary"] = added["summary"] = "This clause appears in a different position."
                break
    return changes