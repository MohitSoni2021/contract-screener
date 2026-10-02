# Issue: Broad questions over long PDFs return incomplete answers

**Status:** Retrieval fix implemented; hierarchical summaries remain a future enhancement
**Area:** Document ingestion, retrieval, and chat

## Observed behavior

The 535-page book *The Subtle Art of Not Giving a Fuck* was accepted and indexed as 101 passages. A narrow request for a brief about the book returned an answer with citations. Broad requests such as “list all important points” and “list down the index” returned “I could not establish it from the retrieved passages.”

## Why this happens

The chat endpoint currently retrieves a small set of passages for every question:

- `backend/app/routers/chat.py` sets `TOP_K = 6` and embeds the current question for a dense-vector Qdrant search.
- The query is filtered to the authenticated owner, document, active state, and index version. This is the data-isolation boundary that prevents one user's document from being searched for another user.
- The answer prompt requires the model to use retrieved evidence and to say when it cannot establish an answer from that evidence.
- Ingestion creates text chunks, but it does not create a document outline, chapter summaries, or a whole-document summary that broad questions can use.

This is why the short brief can work: a few semantically related passages may support it. A request for *all* important points needs coverage across the book. Six nearest passages are not a representative sample of all 535 pages. A table of contents request is also a different task from semantic question answering; a dense search may not retrieve the contents pages even when they are present.

The cautious response is therefore consistent with the evidence-first prompt. The primary issue is retrieval coverage and document structure, rather than the model refusing to answer. The word “index” is ambiguous; in this context the product should interpret it as the book's table of contents, or ask the user to clarify.

## Recommended fix

### 1. Keep the user/document security filter

Every retrieval path, including summaries and outline lookups, must remain scoped by the authenticated owner and document ID. Do not query a shared collection without those filters. Keep citations tied to the selected document's verified source passages.

### 2. Extract document structure during ingestion

Detect the table of contents, headings, and chapter or section boundaries. Store section names and page ranges alongside the existing chunk metadata. For PDFs where extraction cannot reliably detect structure, preserve page ranges and mark the outline as incomplete rather than inventing chapter names.

### 3. Build hierarchical summaries for broad questions

Summarize bounded groups of chunks per section or page range (map step), retaining links to the source chunk IDs and page spans. Then create a document-level summary from those section summaries (reduce step). Persist these as document-derived data associated with the same owner and document. Make this processing resumable and versioned so a failed or repeated ingestion does not mix old summaries with a new document index.

For “important points,” synthesize from the section summaries and attach citations to the underlying verified passages. State which sections or page ranges were covered. If coverage is incomplete, label the answer as partial rather than claiming it includes every important point.

### 4. Route broad questions to the right retrieval mode

Classify requests such as “overview,” “brief,” “key points,” and “all important points” as document-wide questions and retrieve across the hierarchical summaries. Route “table of contents” or “index” requests to the extracted outline and, where useful, a lexical search of the contents pages. Keep the existing top-k vector retrieval for focused questions about a clause, fact, or passage.

Hybrid lexical plus vector retrieval, diversified retrieval across sections, and reranking can improve focused search. Increasing `TOP_K` alone is not a complete solution: it increases context and cost, can return redundant passages, and still cannot demonstrate coverage of the whole book.

### 5. Make coverage visible

Track which sections or page ranges contributed to a broad answer. Return citations to original passages, not only to generated summaries. If the document has no reliable outline or some pages failed extraction, communicate that limit in the answer.

## Acceptance criteria

- A broad-summary question uses coverage from the document's sections, rather than only the six nearest chunks.
- A table-of-contents question returns the extracted contents or reports that a reliable contents section was not found.
- Every answer citation resolves to a verified source passage and page range in the selected user's document.
- No summary or retrieval result can cross owner or document boundaries.
- Incomplete extraction or summary processing is reported as partial coverage; the system does not claim an exhaustive answer without evidence of coverage.
- Focused questions continue to use the existing low-latency passage retrieval path.

## Implemented baseline

- Ingestion now persists a versioned, evidence-derived outline and detected contents text with the document.
- Broad questions use owner/document/index-version filtered Qdrant scroll retrieval with evenly distributed verified passages, and report coverage metadata as complete or partial.
- Contents and index questions use the extracted contents passages and explicitly refuse to invent a contents list when none was found.
- Focused questions retain the six-passage dense retrieval path.
- Citations are normalized with Unicode and whitespace tolerance, recomputed from canonical text, and the UI only renders citations marked verified.
- Completed generated answers without a valid source marker are replaced with an explicit unsupported-answer response.

This baseline does not yet generate persisted map/reduce summaries. It therefore reports passage/page coverage and partial status rather than claiming exhaustive section-level comprehension when the extracted outline or index is incomplete.

## Relevant implementation locations

- `backend/app/routers/chat.py` — `TOP_K`, Qdrant retrieval, evidence-grounded prompt, and answer generation.
- `backend/app/services/chunking.py` — chunk boundaries and page metadata.
- `backend/app/services/ingestion.py` — document processing and persistence flow.
- `backend/app/services/qdrant_repository.py` — vector payload and owner/document filtering.
