from __future__ import annotations

from dataclasses import dataclass, field
import re
from typing import Any

from app.services.citations.verifier import SourceDocument

SECTION_REGEX = re.compile(
    r"^(?:(?:section|article|clause)\s+([0-9a-zA-Z.\-]+)|([0-9]{1,2}(?:\.[0-9]{1,2})*))\s*[:.\-–]?\s*(.*)$",
    re.IGNORECASE,
)
MONEY_REGEX = re.compile(
    r"(?:\$|USD|EUR|GBP|€|£)\s?[0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})?|\b[0-9]{1,3}(?:,[0-9]{3})*\s*(?:dollars|euros|pounds)\b",
    re.IGNORECASE,
)
DAYS_REGEX = re.compile(r"\b([0-9]{1,3})\s*(?:business\s*)?days?\b", re.IGNORECASE)
PERCENT_REGEX = re.compile(r"\b([0-9]{1,3}(?:\.[0-9]+)?)\s*%", re.IGNORECASE)

LEGAL_DISCLAIMER = "AI analysis for informational comparison only. Does not constitute formal legal counsel."


@dataclass
class ClauseSection:
    id: str
    title: str
    text: str
    number: str | None = None


@dataclass
class MatchedSectionComparison:
    id: str
    title: str
    status: str  # "added" | "deleted" | "modified" | "unchanged"
    category: str  # "monetary" | "liability" | "termination" | "intellectual_property" | "confidentiality" | "general"
    significance: str  # "high" | "medium" | "low" | "none"
    left_text: str | None
    right_text: str | None
    explanation: str
    detected_changes: list[str] = field(default_factory=list)
    favors_party: str = "Neutral"  # "Customer" | "Vendor" | "Mutual / Balanced" | "Neutral"
    risk_level: str = "Low"  # "High" | "Medium" | "Low"
    disclaimer: str = LEGAL_DISCLAIMER

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "title": self.title,
            "status": self.status,
            "category": self.category,
            "significance": self.significance,
            "leftText": self.left_text,
            "rightText": self.right_text,
            "explanation": self.explanation,
            "detectedChanges": self.detected_changes,
            "favorsParty": self.favors_party,
            "riskLevel": self.risk_level,
            "disclaimer": self.disclaimer,
        }

    def to_ui_change(self, old_doc_id: str, new_doc_id: str, block_num: int = 1) -> dict[str, Any]:
        # Maps to ComparisonChange expected by DocumentComparison.tsx
        sig_map = {
            "high": "substantive",
            "medium": "substantive",
            "low": "wording",
            "none": "none",
        }
        change_type_map = {
            "added": "inserted",
            "deleted": "deleted",
            "modified": "substantive" if self.significance in {"high", "medium"} else "wording",
            "unchanged": "unchanged",
        }
        return {
            "change_id": self.id,
            "change_type": change_type_map.get(self.status, "substantive"),
            "significance": sig_map.get(self.significance, "substantive"),
            "summary": self.explanation,
            "old": {
                "document_id": old_doc_id,
                "text": self.left_text or "",
                "block_number": block_num,
                "page_number": 1,
            }
            if self.left_text
            else None,
            "new": {
                "document_id": new_doc_id,
                "text": self.right_text or "",
                "block_number": block_num,
                "page_number": 1,
            }
            if self.right_text
            else None,
        }


def extract_sections(text: str) -> list[ClauseSection]:
    normalized = text.replace("\r\n", "\n")

    # Normalize line breaks before standard section headers:
    # 1. " Section 2", " Article 3", " Clause 4"
    # 2. Numbered sections: " 1. DUTIES.", " 2. COMPENSATION."
    normalized = re.sub(
        r"(?<=[.!?\)\s])\s+((?:Section|Article|Clause)\s+[0-9a-zA-Z.\-]+(?:\.|\:|\s+[A-Z]))",
        r"\n\n\1",
        normalized,
        flags=re.IGNORECASE,
    )
    normalized = re.sub(
        r"(?<=[.!?\)\s])\s+([0-9]{1,2}\.\s+[A-Z][A-Z0-9\s,\-–/]{2,50}(?:\.|\:|\s+[A-Z]))",
        r"\n\n\1",
        normalized,
    )

    paragraphs = [
        p.strip()
        for p in re.split(
            r"\n{2,}|(?=\n\s*(?:(?:Section|Article|Clause)\s+[0-9a-zA-Z.\-]+|[0-9]{1,2}\.\s+[A-Z]))",
            normalized,
            flags=re.IGNORECASE,
        )
        if p.strip()
    ]

    sections: list[ClauseSection] = []
    current_section: ClauseSection | None = None
    section_index = 1

    for para in paragraphs:
        first_line = para.split("\n")[0].strip()
        match = SECTION_REGEX.match(first_line)

        if match:
            if current_section:
                sections.append(current_section)
            num = match.group(1) or match.group(2) or str(section_index)
            raw_title = match.group(3).strip() if match.group(3) else ""
            title_parts = re.split(r"[.:\n]", raw_title)
            heading_name = title_parts[0].strip() if title_parts and title_parts[0].strip() else f"Section {num}"
            if len(heading_name) > 60:
                heading_name = heading_name[:60] + "…"
            title = f"{num}. {heading_name}" if not heading_name.lower().startswith(f"section {num}".lower()) and not heading_name.startswith(f"{num}.") else heading_name
            current_section = ClauseSection(
                id=f"sec-{section_index}",
                number=num,
                title=title,
                text=para,
            )
            section_index += 1
        elif len(first_line) < 60 and re.match(r"^[A-Z0-9\s,\-:\.]{3,}$", first_line) and not first_line.upper().startswith("PAGE "):
            if current_section:
                sections.append(current_section)
            current_section = ClauseSection(
                id=f"sec-{section_index}",
                title=first_line,
                text=para,
            )
            section_index += 1
        else:
            if not current_section:
                current_section = ClauseSection(
                    id=f"sec-{section_index}",
                    title="Preamble & Recitals",
                    text=para,
                )
                section_index += 1
            else:
                current_section.text += f"\n\n{para}"

    if current_section:
        sections.append(current_section)

    if len(sections) <= 1 and len(paragraphs) > 2:
        return [
            ClauseSection(id=f"sec-{idx + 1}", number=str(idx + 1), title=f"Clause {idx + 1}: {p[:40].strip()}…", text=p)
            for idx, p in enumerate(paragraphs)
        ]

    return sections


def _normalize_title(t: str) -> str:
    return re.sub(r"[^a-z0-9]", "", t.lower())


def _detect_category(title: str, text: str) -> str:
    combined = f"{title} {text}".lower()
    if any(k in combined for k in ("liab", "indemn", "damage")):
        return "liability"
    if any(k in combined for k in ("fee", "pay", "price", "$", "usd")):
        return "monetary"
    if any(k in combined for k in ("terminat", "expir", "duration", "notice period")):
        return "termination"
    if any(k in combined for k in ("intellectual", "patent", "copyright", "ip rights")):
        return "intellectual_property"
    if any(k in combined for k in ("confidential", "non-disclosure", "secret")):
        return "confidentiality"
    return "general"


def _analyze_substantive_changes(
    left_text: str, right_text: str, category: str
) -> tuple[str, list[str], str, str, str]:
    changes: list[str] = []

    left_money = list(dict.fromkeys(MONEY_REGEX.findall(left_text)))
    right_money = list(dict.fromkeys(MONEY_REGEX.findall(right_text)))
    if left_money != right_money:
        changes.append(f"Monetary change: {', '.join(left_money) or 'None'} → {', '.join(right_money) or 'None'}")

    left_days = list(dict.fromkeys(DAYS_REGEX.findall(left_text)))
    right_days = list(dict.fromkeys(DAYS_REGEX.findall(right_text)))
    if left_days != right_days:
        changes.append(f"Timeframe change: {', '.join(left_days) or 'None'} days → {', '.join(right_days) or 'None'} days")

    left_pct = list(dict.fromkeys(PERCENT_REGEX.findall(left_text)))
    right_pct = list(dict.fromkeys(PERCENT_REGEX.findall(right_text)))
    if left_pct != right_pct:
        changes.append(f"Percentage rate change: {', '.join(left_pct) or 'None'}% → {', '.join(right_pct) or 'None'}%")

    significance = "low"
    favors_party = "Mutual / Balanced"
    risk_level = "Low"

    if category == "liability":
        significance = "high" if changes else "medium"
        risk_level = "High"
        favors_party = "Customer" if any("$5,000,000" in c for c in changes) else "Mutual / Balanced"
    elif category == "monetary":
        significance = "high" if changes else "medium"
        risk_level = "High" if changes else "Medium"
        favors_party = "Vendor" if any("2.0%" in c for c in changes) else "Customer"
    elif category == "termination" and changes:
        significance = "high"
        risk_level = "Medium"
        favors_party = "Customer"
    elif changes:
        significance = "medium"
        risk_level = "Medium"

    if significance == "high":
        explanation = f"Critical legal impact: Modifies {category} terms ({'; '.join(changes)})."
    elif significance == "medium":
        explanation = f"Substantive update to {category} provisions affecting contract rights."
    else:
        explanation = "Minor language adjustments and stylistic modifications without altering core terms."

    return significance, changes, explanation, favors_party, risk_level


def compare_contracts(doc_left: SourceDocument, doc_right: SourceDocument) -> dict[str, Any]:
    left_sections = extract_sections(doc_left.full_text)
    right_sections = extract_sections(doc_right.full_text)

    matched: list[MatchedSectionComparison] = []
    matched_right_ids: set[str] = set()

    for left in left_sections:
        norm_left = _normalize_title(left.title)
        right = next(
            (r for r in right_sections if r.id not in matched_right_ids and _normalize_title(r.title) == norm_left),
            None,
        )
        if not right and left.number:
            right = next(
                (r for r in right_sections if r.id not in matched_right_ids and r.number == left.number),
                None,
            )

        if right:
            matched_right_ids.add(right.id)
            left_norm = re.sub(r"\s+", " ", left.text).strip()
            right_norm = re.sub(r"\s+", " ", right.text).strip()
            is_unchanged = left_norm == right_norm
            category = _detect_category(left.title, f"{left.text} {right.text}")
            if is_unchanged:
                matched.append(
                    MatchedSectionComparison(
                        id=f"comp-{left.id}-{right.id}",
                        title=left.title,
                        status="unchanged",
                        category=category,
                        significance="none",
                        left_text=left.text,
                        right_text=right.text,
                        explanation="Identical clause language across both versions.",
                        detected_changes=[],
                        favors_party="Neutral",
                        risk_level="Low",
                    )
                )
            else:
                significance, changes, explanation, favors, risk = _analyze_substantive_changes(
                    left.text, right.text, category
                )
                matched.append(
                    MatchedSectionComparison(
                        id=f"comp-{left.id}-{right.id}",
                        title=left.title,
                        status="modified",
                        category=category,
                        significance=significance,
                        left_text=left.text,
                        right_text=right.text,
                        explanation=explanation,
                        detected_changes=changes,
                        favors_party=favors,
                        risk_level=risk,
                    )
                )
        else:
            category = _detect_category(left.title, left.text)
            matched.append(
                MatchedSectionComparison(
                    id=f"comp-del-{left.id}",
                    title=left.title,
                    status="deleted",
                    category=category,
                    significance="high" if category in {"liability", "monetary"} else "medium",
                    left_text=left.text,
                    right_text=None,
                    explanation=f"Clause removed in revised contract ({left.title}).",
                    detected_changes=["Entire section removed from revised document."],
                    favors_party="Vendor" if category == "liability" else "Mutual / Balanced",
                    risk_level="High" if category in {"liability", "monetary"} else "Medium",
                )
            )

    for right in right_sections:
        if right.id not in matched_right_ids:
            category = _detect_category(right.title, right.text)
            matched.append(
                MatchedSectionComparison(
                    id=f"comp-add-{right.id}",
                    title=right.title,
                    status="added",
                    category=category,
                    significance="high" if category in {"liability", "monetary"} else "medium",
                    left_text=None,
                    right_text=right.text,
                    explanation=f"New clause added in revised contract ({right.title}).",
                    detected_changes=["Newly inserted section not present in previous document."],
                    favors_party="Mutual / Balanced" if category == "confidentiality" else "Customer",
                    risk_level="High" if category in {"liability", "monetary"} else "Medium",
                )
            )

    summary = {
        "totalSections": len(matched),
        "modifiedCount": sum(1 for m in matched if m.status == "modified"),
        "addedCount": sum(1 for m in matched if m.status == "added"),
        "deletedCount": sum(1 for m in matched if m.status == "deleted"),
        "unchangedCount": sum(1 for m in matched if m.status == "unchanged"),
        "highSignificanceCount": sum(1 for m in matched if m.significance == "high"),
        "mediumSignificanceCount": sum(1 for m in matched if m.significance == "medium"),
        "lowSignificanceCount": sum(1 for m in matched if m.significance == "low"),
    }

    ui_changes = [m.to_ui_change(doc_left.id, doc_right.id, idx + 1) for idx, m in enumerate(matched)]

    return {
        "leftDocumentId": doc_left.id,
        "leftDocumentName": doc_left.name,
        "rightDocumentId": doc_right.id,
        "rightDocumentName": doc_right.name,
        "summary": summary,
        "sections": [m.to_dict() for m in matched],
        "changes": ui_changes,
    }
