from __future__ import annotations

import asyncio
from dataclasses import dataclass
import json
import logging
from typing import Any, Callable

from app.services.citations.verifier import SourceDocument, VerifiedCitation
from app.services.ai.answer import (
    AiOutputError,
    AnswerResult,
    ModelAnswer,
    finalize_answer,
    parse_model_answer,
)
from app.services.ai.prompts import AGENT_SYSTEM_PROMPT
from app.services.ai.synthesis import synthesize_legal_answer
from app.services.ai.tools import TOOL_DECLARATIONS, execute_tool

logger = logging.getLogger(__name__)

MAX_AGENT_ROUNDS = 5
MAX_CALLS_PER_ROUND = 4


@dataclass
class AgentStepEvent:
    round: int
    label: str
    action: str
    tool: str
    args: dict[str, Any] | None
    result_summary: str
    ok: bool

    def to_dict(self) -> dict[str, Any]:
        return {
            "type": "step",
            "round": self.round,
            "label": self.label,
            "action": self.action,
            "tool": self.tool,
            "args": self.args,
            "resultSummary": self.result_summary,
            "ok": self.ok,
        }


async def run_fallback_agent(
    question: str,
    docs: list[SourceDocument],
    on_event: Callable[[dict[str, Any]], None] | None = None,
) -> AnswerResult:
    # Round 1: search_document
    step1 = execute_tool("search_document", {"query": question, "documentId": docs[0].id if docs else None}, docs)
    if on_event:
        on_event(
            AgentStepEvent(
                round=1,
                label=step1.label,
                action=step1.label,
                tool="search_document",
                args={"query": question},
                result_summary="Retrieved candidate contract passages" if step1.ok else step1.error,
                ok=step1.ok,
            ).to_dict()
        )
    await asyncio.sleep(0.05)

    # Round 2: list_clauses
    step2 = execute_tool("list_clauses", {"documentId": docs[0].id if docs else None}, docs)
    if on_event:
        on_event(
            AgentStepEvent(
                round=2,
                label=step2.label,
                action=step2.label,
                tool="list_clauses",
                args={},
                result_summary="Indexed section and clause headings" if step2.ok else step2.error,
                ok=step2.ok,
            ).to_dict()
        )
    await asyncio.sleep(0.05)

    fallback_dict = synthesize_legal_answer(question, docs)
    parsed = ModelAnswer(
        answer=fallback_dict["answer"],
        insufficient_evidence=fallback_dict.get("insufficientEvidence", False),
        citations=fallback_dict.get("citations", []),
    )
    result = finalize_answer(parsed, docs, [])
    if on_event:
        on_event({
            "type": "final",
            "result": result.to_dict(),
            "answer": result.answer,
            "citations": [c.to_dict() for c in result.citations],
        })
    return result


async def run_agent(
    question: str,
    docs: list[SourceDocument],
    ai_client: Any = None,
    chat_model_name: str | None = None,
    on_event: Callable[[dict[str, Any]], None] | None = None,
    max_rounds: int = MAX_AGENT_ROUNDS,
) -> AnswerResult:
    """Multi-round tool execution loop. The round limit is enforced server-side.
    On the last round no tools are offered, forcing the model to answer.
    The final answer is verified exactly like standard chat.
    """
    if ai_client is None:
        return await run_fallback_agent(question, docs, on_event)

    doc_list = "\n".join(f"- {d.id}: {json.dumps(d.name)}" for d in docs)
    messages: list[dict[str, Any]] = [
        {"role": "system", "content": AGENT_SYSTEM_PROMPT},
        {"role": "user", "content": f"Documents in scope:\n{doc_list}\n\nQuestion: {question}"},
    ]

    for round_number in range(1, max_rounds + 1):
        last_round = round_number == max_rounds
        try:
            kwargs: dict[str, Any] = {
                "model": chat_model_name or "openai/gpt-4o-mini",
                "messages": messages,
                "temperature": 0.1,
            }
            if not last_round:
                kwargs["tools"] = TOOL_DECLARATIONS
            else:
                kwargs["response_format"] = {"type": "json_object"}

            response = await ai_client.chat.completions.create(**kwargs)
            choice = response.choices[0].message
        except Exception as exc:
            logger.info("AI provider tool call failed: %s; running fallback agent", exc)
            return await run_fallback_agent(question, docs, on_event)

        tool_calls = choice.tool_calls or []
        if not tool_calls or last_round:
            raw_text = choice.content or "{}"
            try:
                parsed = parse_model_answer(raw_text)
                result = finalize_answer(parsed, docs, [])
                if on_event:
                    on_event({
                        "type": "final",
                        "result": result.to_dict(),
                        "answer": result.answer,
                        "citations": [c.to_dict() for c in result.citations],
                    })
                return result
            except AiOutputError:
                if last_round:
                    return await run_fallback_agent(question, docs, on_event)
                messages.append({"role": "user", "content": "Reply with the JSON object only."})
                continue

        messages.append({
            "role": "assistant",
            "content": choice.content or "",
            "tool_calls": [call.model_dump() for call in tool_calls],
        })

        for call in tool_calls[:MAX_CALLS_PER_ROUND]:
            tool_name = call.function.name
            raw_args = call.function.arguments or "{}"
            try:
                parsed_args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
            except Exception:
                parsed_args = {}

            outcome = execute_tool(tool_name, parsed_args, docs)
            if on_event:
                on_event(
                    AgentStepEvent(
                        round=round_number,
                        label=outcome.label,
                        action=outcome.label,
                        tool=tool_name,
                        args=parsed_args,
                        result_summary=outcome.label if outcome.ok else outcome.error,
                        ok=outcome.ok,
                    ).to_dict()
                )

            tool_content = json.dumps({"result": outcome.data} if outcome.ok else {"error": outcome.error})
            messages.append({
                "role": "tool",
                "tool_call_id": call.id,
                "content": tool_content,
            })

    return await run_fallback_agent(question, docs, on_event)
