# Chat, retrieval, and citations

## Focused question answering

For a question about a specific clause, fact, or passage, Elcara embeds the current question and asks Qdrant for up to six nearest chunks. The query is scoped to the caller's selected document, owner, active state, and index version. The backend also checks each returned payload's ownership and confirms that its text matches the recorded character range in canonical extracted text.

The chat prompt includes the selected evidence and a bounded slice of prior conversation history. Up to 12 prior messages are loaded, with a 16,000-character total history budget. History helps resolve conversational references; it does not grant access to other documents or bypass document retrieval.

## Broad-document and contents questions

Question wording selects one of three modes:

| Mode | Examples | Retrieval behavior |
| --- | --- | --- |
| `focused` | “What is the notice period?” | Up to six semantically nearest verified chunks |
| `broad` | “Give me an overview” or “list the key points” | Scrolls indexed chunks for the selected document, verifies them, then selects distributed passages subject to a bounded source count |
| `contents` | “Show the table of contents” or “list the index” | Uses extracted contents text to rank document chunks and returns verified passages when found |

When focused retrieval has no useful passages for a question that appears to need broader document context, a bounded, evenly distributed fallback can be used. Broad coverage metadata reports counts and page ranges when available. If the contents heuristic did not find a reliable contents section, the system says so instead of inventing one.

These modes improve coverage but do not equal a human reading every page. Broad answers are based on selected passages, not persisted per-chapter map/reduce summaries. Heuristic intent detection can route unusual wording incorrectly, and heuristic outline extraction can miss or misidentify headings. A “complete” retrieval status describes the current index and selected source coverage rules, not a guarantee of perfect semantic understanding.

## Streaming and saved history

Chat responses use server-sent events. The frontend parses named events because network chunks can split or combine event boundaries. Common events include:

- `conversation` — conversation ID for the new or resumed chat.
- `status` — retrieval or answer-generation activity.
- `coverage` — mode and evidence-coverage information.
- `token` — answer text delta.
- `citations` — verified citation objects.
- `done` — final message ID and status.
- `error` — safe failure detail.

User messages, assistant messages, citations, answer status, and coverage are stored in MongoDB. A cancelled response keeps the partial text and is saved with a cancelled status. The UI can reopen conversations for the document.

## Citation verification

The model can suggest source markers and quotes. The server controls the final citations:

1. Resolve each source marker to the retrieved evidence set.
2. Normalize Unicode and whitespace for comparison with extracted text.
3. Verify each proposed quote against the canonical document using the citation verifier.
4. Recompute source offsets and page/block metadata from the document rather than trusting model-reported locations.
5. Return citations marked verified; the frontend only renders verified sources as verified citations.

This catches unsupported or altered quotes. It cannot guarantee that extraction preserved every visual feature of a source, and a verified quote supports only the quoted wording—not every inference in the surrounding answer.

## Citation navigation

- PDF citations include page ranges and character offsets; the client opens a PDF.js text layer at the cited page and highlights matching text items where possible.
- DOCX citations use block and character anchors. The client fetches extracted content and displays a nearby passage with the verified quote highlighted.
- DOCX page numbers are intentionally not promised because pagination depends on fonts and rendering software.

PDF text can be split differently from the extraction output, and duplicate phrases can complicate highlighting. If the viewer cannot render a source, it still displays the verified quote as a fallback.

## Good question patterns

- Ask one focused question at a time when you need a precise clause answer.
- Ask for “key points across the document” when you want broad coverage, then ask follow-ups about individual points.
- Ask for a “table of contents” when you mean the document outline; the word “index” can mean different things.
- If coverage is marked partial or a citation cannot be opened, treat the answer as incomplete and inspect the source directly.
