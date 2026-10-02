# Agentic Document Research

The Part C research workspace is available at `/research` for authenticated users. It is intentionally separate from ordinary document chat and document comparison.

## Demo flow

1. Open **Agent research** from the workspace sidebar.
2. Select a ready PDF or DOCX document.
3. Use the prefilled question or choose **Run demo flow**.
4. Watch each bounded research round and declared tool activity appear in the live trace.
5. Review the final answer and its verified `[[S#]]` source markers.

## Strict tools

The server exposes only these model tools:

- `search_document`: semantic search through the selected, user-owned document.
- `get_section`: read a bounded excerpt around a named section.
- `list_clauses`: list heading-like or numbered clauses, optionally filtered by topic.

Tool names and JSON arguments are validated server-side. Unknown tools and malformed arguments return safe tool errors to the model loop instead of crashing the request.

## Limits and known limitations

- The default maximum is 4 research rounds and 3,200 final-answer model tokens. Configure `RESEARCH_MAX_ROUNDS` and `RESEARCH_MAX_TOKENS` in the backend environment within the server-enforced bounds.
- Tool activity is streamed to the browser, but the final answer is emitted after the bounded loop completes rather than token-by-token.
- `get_section` currently uses extracted text matching and may miss headings with substantially different spelling or OCR errors.
- `list_clauses` uses heading and numbering heuristics; it is not a legal clause parser.
- Long documents remain bounded by the existing extraction, vector retrieval, and source-evidence limits. The agent must not treat an incomplete evidence set as proof that a clause is absent.
- The final answer is source-marker filtered and uses the existing canonical-text/Qdrant quote verification pipeline. Uncited or invented source markers are removed.
- Tracked-change redlining is out of scope for this option.
