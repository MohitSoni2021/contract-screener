# Agentic document research

Agent research is available in the authenticated `/research` workspace as a bounded tool-using mode for one selected, ready document. A separate backend endpoint accepts one to five owned documents, but the current page is connected to the single-document flow. Research complements ordinary chat and the two-document comparison workspace.

## Demo flow

1. Open **Agent research** from the workspace navigation.
2. Select a ready PDF or DOCX.
3. Enter a research question or use the example flow.
4. Review live status and the tools the model chose to call.
5. Read the final findings and verified source quotes.

## Tool loop

The backend does not send the entire document as one prompt. The model may use a limited set of document tools, including:

- `search_document` — find relevant passages in the selected document.
- `get_section` — inspect a bounded section or excerpt.
- `list_clauses` — list heading-like or numbered clauses.
- Definition and page lookup tools where available in the research schema.

The server validates tool names and arguments, limits rounds, detects repeated calls, and returns safe errors for malformed requests. Event streams can contain `status`, `tool_start`, `tool_result`, `answer_delta`, `final`, and `error` events. The final synthesis is emitted after the tool loop; it is not token-streamed throughout each model call.

## Limits and known behavior

- Defaults are `RESEARCH_MAX_ROUNDS=8` and `RESEARCH_MAX_TOKENS=3200`.
- The server clamps rounds to 1–8 and final answer tokens to 500–12,000.
- The configured chat model must support OpenAI-compatible tool/function calling.
- Heading lookup and clause listing use extracted text and heuristics. OCR errors or unusual formatting can make results incomplete.
- The agent can only rely on passages it inspected; an empty search result does not prove a provision is absent.
- Final quotes are verified against canonical extracted text. This verifies quote presence, not the legal conclusion around it.
- Research is bounded by processing limits and tool output limits; it is not an exhaustive legal review.

## API

- `POST /api/research` — non-streaming research request.
- `POST /api/research/stream` — streaming research and trace.
- `POST /api/agent/research` — multi-document capable endpoint accepting `documentIds` and `question`; currently not used by the research page.

See [Advanced features](advanced-features.md) for the product-level overview.
