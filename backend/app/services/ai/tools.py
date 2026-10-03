from __future__ import annotations

from dataclasses import dataclass
import json
import re
from typing import Any

from app.services.citations.locator import page_for_offset
from app.services.citations.verifier import SourceDocument
from app.services.retrieval.keyword import retrieve_chunks

MAX_TOOL_RESULT_CHARS = 8000
SECTION_CHARS = 4000
MAX_CLAUSES = 150

TOOL_DECLARATIONS = [
    {
        "type": "function",
        "function": {
            "name": "search_document",
            "description": "Search the documents for passages relevant to a query.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "The search query keywords or clause name"},
                    "documentId": {"type": "string", "description": "Optional document ID to scope to"},
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_section",
            "description": "Read a numbered section or article, for example '12' or '8.2' or '3.A'.",
            "parameters": {
                "type": "object",
                "properties": {
                    "number": {"type": "string", "description": "The section or clause number"},
                    "documentId": {"type": "string", "description": "Optional document ID to scope to"},
                },
                "required": ["number"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_clauses",
            "description": "List section and clause headings found in the documents.",
            "parameters": {
                "type": "object",
                "properties": {
                    "documentId": {"type": "string", "description": "Optional document ID to scope to"}
                },
            },
        },
    },
]

HEADING_RE = re.compile(
    r"^[ \t]*((?:article|section|clause)\s+[\dIVXivx]+[.:)]?[^\n]{0,80}|\d+(?:\.\d+)*[.)]?[ \t]+[A-Z][^\n]{2,80})$",
    re.MULTILINE | re.IGNORECASE,
)


@dataclass
class ToolOutcome:
    ok: bool
    label: str
    data: Any = None
    error: str = ""


def _scope(docs: list[SourceDocument], doc_id: str | None) -> list[SourceDocument] | None:
    if not doc_id:
        return docs
    target = next((d for d in docs if d.id == doc_id), None)
    return [target] if target else None


def execute_tool(name: Any, args: Any, docs: list[SourceDocument]) -> ToolOutcome:
    """Validates the tool name and arguments before running. Never throws on invalid input."""
    if not isinstance(name, str) or name not in {"search_document", "get_section", "list_clauses"}:
        return ToolOutcome(
            ok=False,
            label="Ignored an unknown tool call",
            error="Unknown tool. Use search_document, get_section or list_clauses.",
        )

    if not isinstance(args, dict):
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except Exception:
                args = {}
        else:
            args = {}

    doc_id = str(args.get("documentId") or args.get("document_id") or "") or None
    targets = _scope(docs, doc_id)
    if targets is None:
        return ToolOutcome(ok=False, label=f"Rejected {name} call", error="documentId is not in scope.")

    if name == "search_document":
        query = str(args.get("query", "")).strip()
        if not query:
            return ToolOutcome(ok=False, label="Rejected search_document call", error="Missing search query.")
        retrieval = retrieve_chunks(targets, query, 5)
        results = [
            {
                "documentId": c["document_id"],
                "pages": [c["page_start"], c["page_end"]],
                "text": c["text"][:1500],
            }
            for c in retrieval.chunks
        ]
        return ToolOutcome(
            ok=True,
            label=f'Searching for "{query}"',
            data={
                "results": results,
                "note": None if results else "No matching passages were retrieved. This does not show the topic is absent.",
            },
        )

    if name == "get_section":
        number = str(args.get("number", "")).strip()
        if not number:
            return ToolOutcome(ok=False, label="Rejected get_section call", error="Missing section number.")
        escaped = re.escape(number)
        pattern = re.compile(
            rf"(^|\n)[ \t]*(?:(?:section|article|clause)\s+)?{escaped}(?:[.):\s]|$)",
            re.IGNORECASE,
        )
        sections = []
        for doc in targets:
            match = pattern.search(doc.full_text)
            if not match:
                continue
            start = match.start() + (len(match.group(1)) if match.group(1) else 0)
            sections.append({
                "documentId": doc.id,
                "page": page_for_offset(doc.pages, start),
                "text": doc.full_text[start : start + SECTION_CHARS],
            })
        if not sections:
            return ToolOutcome(
                ok=False,
                label=f"Reading section {number}",
                error=f"Section {number} was not found by heading search.",
            )
        return ToolOutcome(ok=True, label=f"Reading section {number}", data={"sections": sections})

    # list_clauses
    clauses = []
    for doc in targets:
        for match in HEADING_RE.finditer(doc.full_text):
            clauses.append({
                "documentId": doc.id,
                "page": page_for_offset(doc.pages, match.start()),
                "heading": match.group(1).strip(),
            })
    return ToolOutcome(ok=True, label="Listing clause headings", data={"clauses": clauses[:MAX_CLAUSES]})
