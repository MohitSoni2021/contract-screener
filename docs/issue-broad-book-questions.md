# Broad questions over long PDFs

**Status:** Retrieval improvements implemented; hierarchical summaries remain future work  
**Area:** Ingestion, retrieval, and chat

## Original symptom

A 535-page book was indexed as 101 passages. A short overview question returned a cited answer, while requests for all important points or the book's index returned an insufficient-evidence response.

## Root cause

The original chat flow used six nearest vector chunks for every question. Those chunks can answer focused questions but may not cover a full book. A request for “all important points” requires evidence distributed across the document. A request for an “index” often means the table of contents, which is not reliably found by semantic nearest-neighbor search.

The evidence-first prompt correctly declined to invent a whole-book answer when its retrieved evidence did not support one. The failure was primarily question routing and coverage, rather than a model refusal.

## Implemented improvements

- Detect focused, broad-document, and contents question modes.
- Keep focused questions on the low-latency top-six vector search.
- For broad questions, scroll indexed points filtered by owner, document, active state, and index version; validate point content against canonical text; then choose up to 18 passages distributed through the document.
- Report chunk and page-range coverage. If selected evidence does not cover all indexed chunks, label the answer as partial and avoid claiming that a topic is absent from the full document.
- For contents questions, use extracted contents text to rank passages and explicitly say when a reliable contents section was not found.
- Extract and persist basic outline and contents metadata during ingestion.
- Preserve source citations to verified canonical text.

## Remaining limits

Distributed sampling improves breadth but does not provide exhaustive semantic coverage. For long documents, the model receives only a bounded subset of all verified chunks. The current outline and contents extraction is heuristic, and unusual layouts can hide the contents page or misidentify headings. A document coverage count describes what was indexed and supplied; it does not guarantee that every concept has been understood.

## Recommended next step

Build versioned section summaries in a map/reduce pipeline. Summarize bounded chunk groups per section or page range, retaining source chunk IDs. Synthesize document-level overviews from those summaries, and attach answer citations back to the original verified passages. Persist processing completion and coverage so interrupted jobs can resume and broad answers can report partial status accurately.

Increasing the vector `TOP_K` alone is insufficient. It can increase token cost and redundant evidence without ensuring representation from the whole document.

## Acceptance criteria

- Focused questions retain the existing top-six retrieval behavior.
- Broad questions retrieve evidence from across the selected document and display whether coverage is partial.
- Contents questions return only supported outline information and clearly report when none was found.
- Each answer citation opens a verified passage from the selected user's document.
- All vector operations remain filtered by authenticated owner and document ID.
- A future summary hierarchy remains versioned, resumable, and linked to original source passages.

## Relevant code

- `backend/app/routers/chat.py` — mode detection, retrieval, coverage, prompt, and SSE events.
- `backend/app/services/structure.py` — outline and contents heuristics.
- `backend/app/services/ingestion.py` — extraction, metadata persistence, and indexing.
- `backend/app/services/qdrant_repository.py` — ownership and index-version filters.
