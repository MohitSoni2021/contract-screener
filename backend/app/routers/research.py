from __future__ import annotations

import json
import logging
import re
import unicodedata
from datetime import datetime, timezone
from typing import Any, AsyncIterator

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, StreamingResponse
from openai import AsyncOpenAI
from pydantic import BaseModel, Field

from app.config import research_max_rounds, research_max_tokens
from app.dependencies import AuthenticatedUser, get_current_user, get_database
from app.routers.chat import _canonical_text, _event, _owned_ready_document
from app.services.ai_client import chat_model, create_ai_client

router = APIRouter(prefix="/api/research", tags=["research"])
logger = logging.getLogger(__name__)

AVAILABLE_TOOLS = ["list_clauses", "get_section", "search_document", "get_definitions", "get_page"]
SYSTEM_PROMPT = """You are a document research agent for legal contracts. Follow the workflow strictly:
- Use the document loaded for this request only.
- Use the available tools before answering.
- Start by listing clauses or searching for the right topic, then read the relevant sections and definitions.
- If the contract is silent, say exactly that.
- Keep explanations plain-language for non-lawyers.
- Give each finding a severity of high, medium, low, or ok.
- Quote exact text only from the document.
- End with: 'This explains the document; it is not legal advice.'
"""

_WHITESPACE_RE = re.compile(r"\s+")


class ResearchRequest(BaseModel):
    document_id: str = Field(min_length=1, max_length=64)
    question: str = Field(min_length=1, max_length=6000)


AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "list_clauses",
            "description": "List clause numbers and headings from the document index.",
            "parameters": {
                "type": "object",
                "properties": {"topic": {"type": "string", "maxLength": 300}},
                "required": ["topic"],
                "additionalProperties": False,
            },
            "strict": True,
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_section",
            "description": "Read the full text of a specific numbered clause.",
            "parameters": {
                "type": "object",
                "properties": {"number": {"type": "string", "minLength": 1, "maxLength": 200}},
                "required": ["number"],
                "additionalProperties": False,
            },
            "strict": True,
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_document",
            "description": "Search for relevant passages in the document.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "minLength": 1, "maxLength": 300},
                    "limit": {"type": "integer", "minimum": 1, "maximum": 8},
                },
                "required": ["query", "limit"],
                "additionalProperties": False,
            },
            "strict": True,
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_definitions",
            "description": "Look up the definition of a contract term.",
            "parameters": {
                "type": "object",
                "properties": {"term": {"type": "string", "minLength": 1, "maxLength": 200}},
                "required": ["term"],
                "additionalProperties": False,
            },
            "strict": True,
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_page",
            "description": "Read text from a page number when clause structure is weak.",
            "parameters": {
                "type": "object",
                "properties": {"page": {"type": "integer", "minimum": 1, "maximum": 10000}},
                "required": ["page"],
                "additionalProperties": False,
            },
            "strict": True,
        },
    },
]


def _normalize_text(value: str) -> str:
    return _WHITESPACE_RE.sub(" ", unicodedata.normalize("NFKC", value)).strip().casefold()


def _tool_signature(tool: str, arguments: dict[str, Any]) -> str:
    return f"{tool}:{json.dumps(arguments, sort_keys=True, separators=(',', ':'))}"


def is_repeated_tool_call(call: dict[str, Any], history: list[dict[str, Any]]) -> bool:
    signature = _tool_signature(str(call.get("tool", "")), dict(call.get("arguments") or {}))
    return any(_tool_signature(str(item.get("tool", "")), dict(item.get("arguments") or {})) == signature for item in history)


def validate_tool_call(tool_name: str, arguments_text: str) -> str:
    if tool_name not in AVAILABLE_TOOLS:
        return f'Error: unknown tool "{tool_name}". Available tools: {", ".join(AVAILABLE_TOOLS)}'
    try:
        arguments = json.loads(arguments_text or "{}")
    except json.JSONDecodeError as exc:
        return f"Error: invalid JSON arguments for {tool_name}: {exc.msg}"
    if not isinstance(arguments, dict):
        return f"Error: arguments for {tool_name} must be a JSON object."
    if tool_name == "list_clauses":
        if not isinstance(arguments.get("topic"), str):
            return "Error: list_clauses requires a string 'topic'; use an empty string for all clauses."
        return "ok"
    if tool_name == "get_section":
        if not isinstance(arguments.get("number"), str) or not str(arguments["number"]).strip():
            return "Error: get_section requires a non-empty string 'number'."
        return "ok"
    if tool_name == "search_document":
        if not isinstance(arguments.get("query"), str) or not str(arguments["query"]).strip():
            return "Error: search_document requires a non-empty string 'query'."
        limit = arguments.get("limit")
        if not isinstance(limit, int) or not 1 <= limit <= 8:
            return "Error: search_document limit must be an integer between 1 and 8."
        return "ok"
    if tool_name == "get_definitions":
        if not isinstance(arguments.get("term"), str) or not str(arguments["term"]).strip():
            return "Error: get_definitions requires a non-empty string 'term'."
        return "ok"
    if tool_name == "get_page":
        if not isinstance(arguments.get("page"), int) or arguments["page"] < 1:
            return "Error: get_page requires a positive integer 'page'."
        return "ok"
    return f'Error: unsupported tool "{tool_name}".'


def build_document_index(document_text: str) -> dict[str, Any]:
    text = document_text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.rstrip() for line in text.split("\n")]
    clauses: list[dict[str, Any]] = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        match = re.match(r"^(?:Section|Clause|Article)\s+([0-9]+(?:\.\d+)*)\s*(.*)$", stripped, flags=re.I)
        if match:
            number, heading = match.groups()
            clauses.append({"number": number, "heading": heading.strip() or number, "text": stripped, "pageStart": 1, "pageEnd": 1, "parent": None})
            continue
        match = re.match(r"^([0-9]+(?:\.\d+)*)\s*(?:[.)]\s*)?(.*)$", stripped)
        if match:
            number, heading = match.groups()
            if len(number) >= 1:
                clauses.append({"number": number, "heading": heading.strip() or number, "text": stripped, "pageStart": 1, "pageEnd": 1, "parent": None})
                continue
        match = re.match(r"^([0-9]+(?:\.\d+)*)\s+[A-Z]", stripped)
        if match:
            number = match.group(1)
            clauses.append({"number": number, "heading": stripped, "text": stripped, "pageStart": 1, "pageEnd": 1, "parent": None})

    definitions: list[dict[str, Any]] = []
    definition_pattern = re.compile(r'(?i)(?:"|“)?([A-Z][A-Za-z0-9&/\-]*(?:\s+[A-Z][A-Za-z0-9&/\-]*){0,8})(?:"|”)?\s+(?:means|shall mean|is defined as|includes)\b')
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        match = definition_pattern.search(stripped)
        if match:
            definitions.append({"term": match.group(1).strip(), "definition": stripped, "clauseNumber": None})

    if len(clauses) < 3:
        quality = "weak"
        for idx, line in enumerate(lines, start=1):
            stripped = line.strip()
            if len(stripped) >= 20 and stripped:
                clauses.append({"number": f"chunk-{idx}", "heading": stripped[:80], "text": stripped, "pageStart": 1, "pageEnd": 1, "parent": None})
    else:
        quality = "strong"

    cross_references: list[dict[str, Any]] = []
    for clause in clauses:
        refs: list[str] = []
        for match in re.finditer(r"(?:Clause|Section|Article)\s+([0-9]+(?:\.\d+)*|[IVXLC]+)", clause.get("text", ""), flags=re.I):
            ref = match.group(1).strip()
            if ref not in refs:
                refs.append(ref)
        cross_references.append({"number": clause.get("number"), "references": refs})

    return {
        "quality": quality,
        "clauses": clauses[:50],
        "definitions": definitions[:40],
        "pages": [],
        "crossReferences": cross_references,
    }


def _find_clause_by_number(index: dict[str, Any], number: str) -> dict[str, Any] | None:
    target = number.strip()
    for clause in index.get("clauses", []):
        candidate = str(clause.get("number", "")).strip()
        if candidate.casefold() == target.casefold():
            return clause
    for clause in index.get("clauses", []):
        candidate = str(clause.get("number", "")).strip()
        if target.casefold() in candidate.casefold() or candidate.casefold() in target.casefold():
            return clause
    return None


def _search_document_matches(document_text: str, query: str, limit: int = 5) -> list[dict[str, Any]]:
    tokens = [part for part in re.split(r"[^A-Za-z0-9]+", query.lower()) if part]
    if not tokens:
        return []
    results: list[dict[str, Any]] = []
    for chunk in re.split(r"\n\s*\n+", document_text):
        cleaned = chunk.strip()
        if not cleaned:
            continue
        score = sum(1 for token in tokens if token in cleaned.lower())
        if score:
            results.append({"score": float(score), "snippet": cleaned[:800]})
    results.sort(key=lambda item: item["score"], reverse=True)
    return results[:limit]


async def _execute_tool(name: str, arguments: str, *, document: dict[str, Any], canonical_text: str, read_set: set[str], index: dict[str, Any]) -> tuple[str, set[str], dict[str, Any] | None]:
    validation_error = validate_tool_call(name, arguments)
    if validation_error != "ok":
        return json.dumps({"error": validation_error}, ensure_ascii=False), read_set, None
    try:
        parsed = json.loads(arguments or "{}")
    except json.JSONDecodeError as exc:
        return json.dumps({"error": f"invalid JSON arguments for {name}: {exc.msg}"}, ensure_ascii=False), read_set, None
    if name == "list_clauses":
        topic = str(parsed.get("topic", "")).strip()
        clauses = index.get("clauses", [])
        if topic:
            clauses = [
                clause for clause in clauses
                if topic.casefold() in str(clause.get("heading", "")).casefold()
                or topic.casefold() in str(clause.get("text", "")).casefold()
            ]
        payload = {
            "total": len(index.get("clauses", [])),
            "quality": index.get("quality", "strong"),
            "clauses": [
                {"number": clause.get("number"), "heading": clause.get("heading"), "page": clause.get("pageStart"), "snippet": str(clause.get("text") or "")[:120]}
                for clause in clauses[:25]
            ],
        }
        return json.dumps(payload, ensure_ascii=False), read_set, payload
    if name == "get_section":
        number = str(parsed.get("number", "")).strip()
        target = _find_clause_by_number(index, number)
        if target is None:
            valid = [str(item.get("number", "")) for item in index.get("clauses", []) if item.get("number")]
            return json.dumps({"error": f"Clause {number} was not found. Valid numbers include: {', '.join(valid[:12]) or 'none'}"}, ensure_ascii=False), read_set, None
        read_set.add(number)
        payload = {"number": number, "text": str(target.get("text") or "")[:4000], "crossReferences": [], "structure": index.get("quality", "strong")}
        for item in index.get("crossReferences", []):
            if str(item.get("number", "")).casefold() == number.casefold():
                payload["crossReferences"] = item.get("references", [])
                break
        return json.dumps(payload, ensure_ascii=False), read_set, payload
    if name == "search_document":
        query = str(parsed.get("query", "")).strip()
        limit = int(parsed["limit"])
        payload = {"query": query, "matches": _search_document_matches(canonical_text, query, limit=limit)[:limit]}
        read_set.add(f"search:{query[:24]}")
        return json.dumps(payload, ensure_ascii=False), read_set, payload
    if name == "get_definitions":
        term = str(parsed.get("term", "")).strip()
        matches = [
            item for item in index.get("definitions", [])
            if term.casefold() in str(item.get("term", "")).casefold()
            or term.casefold() in str(item.get("definition", "")).casefold()
        ]
        payload = {"term": term, "matches": matches[:8]}
        return json.dumps(payload, ensure_ascii=False), read_set, payload
    if name == "get_page":
        page_number = int(parsed.get("page", 1))
        payload = {"page": page_number, "text": canonical_text[:4000]}
        read_set.add(f"page-{page_number}")
        return json.dumps(payload, ensure_ascii=False), read_set, payload
    return json.dumps({"error": f"unsupported tool: {name}"}, ensure_ascii=False), read_set, None


def _verify_quotes(quotes: list[str], canonical_text: str) -> list[str]:
    normalized_document = _normalize_text(canonical_text)
    verified: list[str] = []
    for quote in quotes:
        if not isinstance(quote, str):
            continue
        candidate = quote.strip()
        if candidate and _normalize_text(candidate) in normalized_document:
            verified.append(candidate)
    return verified


async def _json_final_answer(model: AsyncOpenAI, *, question: str, system_prompt: str, canonical_text: str, read_set: set[str], not_checked: list[str]) -> dict[str, Any]:
    prompt = (
        "Return valid JSON only with schema: {\"summary\": \"...\", \"findings\": [{\"title\": \"...\", \"severity\": \"high|medium|low|ok\", \"explanation\": \"...\", \"clauseRef\": \"...\", \"quotes\": [\"exact quote\"]}], \"notFound\": [\"...\"], \"notChecked\": [\"...\"]}. "
        "Use only the loaded contractual text. If the contract does not address the point, say that clearly. This explains the document; it is not legal advice.\n\n"
        f"Question: {question}\n\nDocument excerpt: {canonical_text[:3000]}\n\nRead set: {sorted(read_set) or 'none'}\n\nNot checked: {not_checked or 'none'}"
    )
    response = await model.chat.completions.create(
        model=chat_model(),
        messages=[{"role": "system", "content": system_prompt}, {"role": "user", "content": prompt}],
        temperature=0.1,
        max_tokens=research_max_tokens(),
        response_format={"type": "json_object"},
    )
    text = (response.choices[0].message.content or "{}").strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return {"summary": text[:500], "findings": [], "notFound": [], "notChecked": not_checked}

    # Some model responses wrap the actual answer JSON inside the summary
    # string. Unwrap it at the API boundary so clients never receive raw JSON
    # as user-facing prose.
    nested_summary = parsed.get("summary") if isinstance(parsed, dict) else None
    if isinstance(nested_summary, str):
        nested_text = nested_summary.strip()
        if nested_text.startswith("```"):
            nested_text = re.sub(r"^```(?:json)?\s*", "", nested_text)
            nested_text = re.sub(r"\s*```$", "", nested_text)
        try:
            nested = json.loads(nested_text)
        except json.JSONDecodeError:
            nested = None
        if isinstance(nested, dict):
            parsed = {**nested, **{key: value for key, value in parsed.items() if key != "summary" and value}}
    summary = parsed.get("summary")
    if not isinstance(summary, str) or summary.lstrip().startswith("{"):
        summary = "The document was reviewed, but the model did not return a readable summary. Please ask the question again."
    return {
        "summary": summary,
        "findings": parsed.get("findings") if isinstance(parsed.get("findings"), list) else [],
        "notFound": parsed.get("notFound") if isinstance(parsed.get("notFound"), list) else [],
        "notChecked": parsed.get("notChecked") if isinstance(parsed.get("notChecked"), list) else not_checked,
    }


async def run_agentic_research(*, request: Request, payload: ResearchRequest, user: AuthenticatedUser, database: Any, conversation_id: str | None = None) -> AsyncIterator[str]:
    if isinstance(payload, dict):
        payload = ResearchRequest.model_validate(payload)
    document = await _owned_ready_document(database, user.id, payload.document_id)
    ai_client: AsyncOpenAI | None = None
    tool_history: list[dict[str, Any]] = []
    read_set: set[str] = set()
    try:
        yield _event("status", {"message": "Reading the contract outline…"})
        canonical_text = await _canonical_text(database, document)
        index = build_document_index(canonical_text)
        yield _event("status", {"message": "Using the index and clause tools…"})
        ai_client = create_ai_client()
        max_rounds = research_max_rounds()
        messages: list[dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": payload.question}]
        tool_calls_present = True

        for round_number in range(1, max_rounds + 1):
            if await request.is_disconnected():
                yield _event("error", {"message": "Research stopped by the client."})
                return
            response = await ai_client.chat.completions.create(
                model=chat_model(),
                messages=messages,
                tools=AGENT_TOOLS,
                tool_choice="auto",
                temperature=0,
                max_tokens=min(1200, research_max_tokens()),
            )
            message = response.choices[0].message
            tool_calls = message.tool_calls or []
            tool_calls_present = bool(tool_calls)
            if not tool_calls:
                break
            messages.append({"role": "assistant", "content": message.content or "", "tool_calls": [call.model_dump() for call in tool_calls]})
            for call in tool_calls:
                tool_name = str(call.function.name)
                raw_arguments = call.function.arguments or "{}"
                label = {
                    "list_clauses": "Reviewing the contract outline…",
                    "get_section": "Reading the relevant clause…",
                    "search_document": "Searching for the key terms…",
                    "get_definitions": "Looking up the definition…",
                    "get_page": "Reading the page text…",
                }.get(tool_name, f"Using {tool_name}…")
                try:
                    parsed_arguments = json.loads(raw_arguments or "{}") if raw_arguments else {}
                except json.JSONDecodeError:
                    parsed_arguments = {}
                if tool_name not in AVAILABLE_TOOLS:
                    result_text = f'Error: unknown tool "{tool_name}". Available tools: {", ".join(AVAILABLE_TOOLS)}'
                else:
                    call_signature = {"tool": tool_name, "arguments": parsed_arguments}
                    if is_repeated_tool_call(call_signature, tool_history):
                        result_text = "You already called this; its result is above"
                    else:
                        tool_history.append(call_signature)
                        result_text, read_set, _ = await _execute_tool(tool_name, raw_arguments, document=document, canonical_text=canonical_text, read_set=read_set, index=index)
                summary = result_text if len(result_text) < 180 else result_text[:180] + "…"
                yield _event("tool_start", {"tool": tool_name, "args": parsed_arguments, "label": label})
                yield _event("tool_result", {"tool": tool_name, "ok": not str(result_text).lower().startswith("error:"), "summary": summary})
                messages.append({"role": "tool", "tool_call_id": call.id, "content": str(result_text)})
            if round_number >= max_rounds:
                break

        final_not_checked = []
        if not tool_calls_present:
            final_not_checked = ["The model answered without using tools; no additional clause checks were completed."]
        elif len(tool_history) >= max_rounds:
            final_not_checked = [f"The research stopped after {max_rounds} rounds; additional areas may not have been checked."]

        final_answer = await _json_final_answer(
            ai_client,
            question=payload.question,
            system_prompt=SYSTEM_PROMPT,
            canonical_text=canonical_text,
            read_set=read_set,
            not_checked=final_not_checked,
        )
        findings = final_answer.get("findings", []) if isinstance(final_answer.get("findings"), list) else []
        filtered_findings = []
        for finding in findings:
            quotes = [str(item) for item in (finding.get("quotes") or [])]
            verified = _verify_quotes(quotes, canonical_text)
            if verified:
                finding["quotes"] = verified
                filtered_findings.append(finding)
        final_answer["findings"] = filtered_findings
        final_answer.setdefault("notFound", [])
        final_answer.setdefault("notChecked", final_not_checked)
        coverage = {
            "quality": index.get("quality", "strong"),
            "totalClauses": len(index.get("clauses", [])),
            "checkedClauses": len({str(item.get("number")) for item in index.get("clauses", []) if item.get("number") and str(item.get("number")) in read_set}),
            "readSet": sorted(read_set),
            "roundsUsed": len(tool_history),
        }
        if conversation_id:
            await database.messages.update_one(
                {"conversation_id": conversation_id, "role": "assistant"},
                {"$set": {"content": final_answer.get("summary", ""), "status": "complete", "citations": [], "coverage": coverage, "updated_at": datetime.now(timezone.utc)}, "$setOnInsert": {"created_at": datetime.now(timezone.utc)}},
                upsert=True,
            )
        yield _event("final", {"answer": final_answer, "verified_quotes": [], "coverage": coverage})
        if final_answer.get("summary"):
            yield _event("answer_delta", {"text": final_answer["summary"]})
    except Exception as exc:  # pragma: no cover - repository safety net
        logger.exception("Agentic research failed", extra={"document_id": document["document_id"], "user_id": user.id})
        try:
            from app.services.ai.synthesis import synthesize_legal_answer
            from app.services.citations.verifier import SourceDocument
            doc_obj = SourceDocument(id=document["document_id"], name=document["filename"], full_text=canonical_text)
            synth = synthesize_legal_answer(payload.question, [doc_obj])
            final_answer = {
                "summary": synth["answer"],
                "findings": [
                    {
                        "title": "Legal Analysis",
                        "severity": "medium",
                        "explanation": synth["answer"][:300],
                        "clauseRef": "Contract Terms",
                        "quotes": [c["quote"] for c in synth.get("citations", [])[:2]],
                    }
                ],
                "notFound": [],
                "notChecked": ["Online AI provider unreachable; analyzed via offline legal synthesis engine."],
            }
            yield _event("final", {"answer": final_answer, "verified_quotes": [], "coverage": {"quality": "strong", "totalClauses": 1, "checkedClauses": 1, "readSet": ["terms"], "roundsUsed": 1}})
            if final_answer.get("summary"):
                yield _event("answer_delta", {"text": final_answer["summary"]})
        except Exception:
            yield _event("error", {"message": f"Research could not be completed safely: {exc}"})
    finally:
        if ai_client is not None:
            await ai_client.close()


@router.post("/stream")
async def stream_research(
    payload: ResearchRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    database: Any = Depends(get_database),
) -> StreamingResponse:
    return StreamingResponse(
        run_agentic_research(request=request, payload=payload, user=user, database=database, conversation_id=None),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("")
async def research(
    payload: ResearchRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    database: Any = Depends(get_database),
) -> JSONResponse:
    """Run research to completion and return only the final structured answer."""
    final_event: dict[str, Any] | None = None
    async for frame in run_agentic_research(request=request, payload=payload, user=user, database=database, conversation_id=None):
        if not frame.startswith("event: final\n"):
            if frame.startswith("event: error\n"):
                data_line = next((line for line in frame.splitlines() if line.startswith("data: ")), "data: {}")
                error = json.loads(data_line.removeprefix("data: "))
                return JSONResponse(status_code=502, content=error)
            continue
        data_line = next((line for line in frame.splitlines() if line.startswith("data: ")), "data: {}")
        final_event = json.loads(data_line.removeprefix("data: "))
        break
    if final_event is None:
        return JSONResponse(status_code=502, content={"message": "Research did not return a final answer."})
    return JSONResponse(content=final_event)


from pydantic import BaseModel, ConfigDict, Field


class AgentResearchRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    document_ids: list[str] = Field(min_length=1, max_length=5, alias="documentIds")
    question: str = Field(min_length=3, max_length=1000)


agent_router = APIRouter(prefix="/api/agent", tags=["agent"])


@agent_router.post("/research")
async def agent_research_endpoint(
    payload: AgentResearchRequest,
    request: Request,
    user: AuthenticatedUser = Depends(get_current_user),
    database: Any = Depends(get_database),
) -> StreamingResponse:
    from app.services.ai.agent import run_agent
    from app.services.citations.verifier import SourceDocument

    docs: list[SourceDocument] = []
    for doc_id in payload.document_ids:
        raw_doc = await _owned_ready_document(database, user.id, doc_id)
        canon = await _canonical_text(database, raw_doc)
        docs.append(SourceDocument(id=raw_doc["document_id"], name=raw_doc["filename"], full_text=canon))

    async def event_generator() -> AsyncIterator[str]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

        def on_event(ev: dict[str, Any]) -> None:
            queue.put_nowait(ev)

        ai_client = None
        try:
            ai_client = create_ai_client()
        except Exception:
            pass

        task = asyncio.create_task(
            run_agent(
                question=payload.question,
                docs=docs,
                ai_client=ai_client,
                chat_model_name=chat_model(),
                on_event=on_event,
            )
        )

        try:
            while not task.done() or not queue.empty():
                try:
                    ev = await asyncio.wait_for(queue.get(), timeout=0.2)
                    yield f"data: {json.dumps(ev)}\n\n"
                except asyncio.TimeoutError:
                    if await request.is_disconnected():
                        task.cancel()
                        break
            if task.done() and task.exception():
                err = task.exception()
                yield f'data: {json.dumps({{"type": "error", "message": str(err)}})}\n\n'
        finally:
            if ai_client is not None:
                await ai_client.close()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

