# Implementation plan

The hiring assignment has a three-day deadline and evaluates working behavior over feature count. Finish a trustworthy single-document flow first, then spend remaining time on the advanced requirements.

## Suggested order

### 1. Foundation

- FastAPI project, configuration, health endpoint, Qdrant Docker instructions, database migrations.
- Upload validation for PDF/DOCX, generated document IDs, status lifecycle, document library/delete.
- Text extraction with page/block references; fail clearly for image-only/scanned PDFs with no readable text.
- Configurable ingestion caps, page-count preflight, and separate MongoDB-backed ingestion workers with renewable leases.

### 2. Index and single-document chat

- Canonical text and chunk/source-location representation.
- Batch OpenAI embeddings and Qdrant upsert with `owner_id`, `document_id`, `index_version` payload.
- Centralized mandatory filter helper and tests for ownership scoping before enabling multi-user auth.
- Similarity retrieval plus history-aware streamed answer; SSE cancellation persists partial output.
- Persist conversations and messages per document.

The single-document chat flow, history API, SSE stream, source verification, and MongoDB-backed ingestion queue are implemented in the current starter. The points below remain completion criteria for validation and higher quality: adversarial quote checks, robust cancellation cleanup, and comprehensive clause coverage.

### 3. Citation correctness and UI

- Structured model output references candidate chunk IDs and quotes.
- Server resolves chunks, verifies quote text with whitespace-tolerant matching, and recomputes location.
- Unsupported statements produce an explicit insufficient-evidence response.
- PDF citation navigation with matching text-layer spans highlighted; DOCX citations show verified excerpts and stable block locations (rendered DOCX pagination is not provided).
- Test adversarially: invented quote, paraphrase, quote duplicated, quote across line/page breaks, wrong chunk ID, and answer with no evidence.

### 4. Large and advanced document features

- For long files, use hierarchical section/clause indexing or staged retrieval. Never claim comprehensive absence based only on top-k chunks. Track which sections were searched and qualify incomplete coverage.
- Multi-document questions: user selects documents, retrieval filters by the selected owned IDs, citations include document IDs/names, and every quote is verified against its own document.
- Comparison: segment both versions into clauses/paragraphs, align semantically, classify substantive changes (for example, monetary caps), and sort by significance. Keep the source text and explanation distinct.

### 5. Part C choice

Choose **Option 2: Agentic document research** as the planned Part C challenge. It builds naturally on Python retrieval tools and large-document coverage, and it can expose concrete tool activity in the UI. Keep the loop bounded (for example, a small configurable maximum of rounds), validate tool names and arguments against strict schemas, handle malformed calls as recoverable errors, and run final quote verification unchanged. If delivery time is too short, show an honest partial implementation and explain the limitation rather than claiming it is complete.

Tracked-change redlining is a viable alternative, but preserving DOCX formatting while writing genuine Word revisions is a separate high-risk document-engineering project. Do not attempt both Part C options under the assignment deadline.

## Completion gates

- A complete answer is grounded only in retrieved document evidence; every displayed quote is verified.
- Cross-owner access is impossible when authentication is enabled, including by changing IDs.
- A 150-page test document does not silently become a partial-document answer.
- Stream, stop, resume history, delete, error, and empty states are usable in the deployed app.
- README accurately lists finished and unfinished behavior; include real screenshots, deployed link, and demo video when available.

## Scope note

The assignment says assume one user and no account system. The product request adds registration/login, so the starter implements auth and scopes uploads to the authenticated user. The current milestone enforces one active document per account, processes PDF/DOCX text in the background, and indexes it in Qdrant with mandatory owner/document payloads. Keep these filters mandatory in all future Qdrant access paths; never rely on an unfiltered shared Qdrant search.
