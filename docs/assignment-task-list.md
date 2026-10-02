# Hiring Assignment Task List

Status is based on the implementation currently in the repository and the requirements in `hiring assignment.pdf`.

## Status legend

- **Done**: implemented in the current code path.
- **Partial**: a useful implementation exists, but an assignment requirement or edge case is still missing.
- **Remaining**: not implemented or not yet demonstrated.

## Part A: Core features

### 1. Document upload and processing

- [x] **Done**: Accept PDF and DOCX uploads.
- [x] **Done**: Reject unsupported extensions and validate basic file signatures.
- [x] **Done**: Enforce an upload-size limit with a clear error.
- [x] **Done**: Extract PDF text with page/block locations.
- [x] **Done**: Extract DOCX paragraphs and tables with block locations.
- [x] **Done**: Queue processing in MongoDB and run it through a background worker.
- [x] **Done**: Show queued, extracting, chunking, embedding, and indexing progress.
- [x] **Done**: Detect empty or scanned PDFs with no readable text and fail processing instead of saving an apparently valid empty document.
- [x] **Done**: Persist canonical extracted text and indexed chunks.
- [x] **Done**: Maintain a document library of multiple active uploaded files, with owner-scoped listing, opening, processing, and deletion in the UI and API.
- [x] **Done**: Open and delete an uploaded document, including cleanup/invalidation of its vector index.
- [ ] **Partial**: Added focused automated tests for invalid files, empty files, scanned PDFs, DOCX tables, size limits, and verified quote isolation. Test execution and worker-recovery coverage remain to be completed in a working test environment.

### 2. Chat with a document

- [x] **Done**: Ask questions about a ready document.
- [x] **Done**: Retrieve document passages using embeddings and mandatory owner/document filters.
- [x] **Done**: Stream answer tokens over SSE.
- [x] **Done**: Show retrieval and answer-writing status in the UI.
- [x] **Done**: Stop an answer from the UI; preserve the generated partial response as cancelled/partial history.
- [x] **Done**: Save conversations and messages per document.
- [x] **Done**: Reopen saved conversations.
- [ ] **Remaining**: Add automated tests for stream completion, client cancellation, server disconnect cleanup, partial persistence, and retry/error states.

### 3. Verified quotes

- [x] **Done**: Keep source text and source locations in indexed payloads.
- [x] **Done**: Verify indexed passages against canonical document text before displaying them.
- [x] **Done**: Use Unicode/whitespace normalization so extraction line-break differences do not cause false quote failures.
- [x] **Done**: Recompute quote locations from application-owned document text rather than trusting model positions.
- [x] **Done**: Remove unsupported source markers and avoid presenting unverified model text as a quote.
- [x] **Done**: Return an explicit insufficient-evidence response when retrieval cannot support an answer.
- [ ] **Partial**: The current answer protocol cites verified retrieved chunks, and focused tests cover normalized passages and wrong-document source rejection. Adversarial tests for invented quotes, paraphrases, duplicate passages, wrong source IDs, cross-line/page quotes, and answers with no evidence are still needed.
- [ ] **Remaining**: Decide and implement a strict policy for factual answer claims that have no source marker; currently the model is instructed to mark claims, but this should be enforced with tests and response validation.

### 4. Large documents

- [x] **Done**: Chunk documents with overlap and location metadata.
- [x] **Done**: Use semantic retrieval for focused questions.
- [x] **Done**: Use bounded, distributed excerpts and coverage metadata for broad questions.
- [x] **Done**: Qualify incomplete document-wide answers instead of claiming that an item is absent from the entire document.
- [ ] **Partial**: The broad strategy samples a bounded number of indexed chunks, so it is safer than pretending to read everything but is not a complete hierarchical section/clause search.
- [ ] **Remaining**: Test with a 150-page contract and verify ingestion limits, retrieval quality, timeout behavior, broad-question coverage, and absence claims.

## Part B: Advanced features

### 5. Citation highlighting

- [ ] **Partial**: PDF citations open in a PDF viewer and highlight matching text-layer items using normalized text.
- [ ] **Partial**: The current matching is heuristic and does not yet guarantee correct highlighting for multi-line quotes, quotes crossing page breaks, or repeated identical passages.
- [ ] **Remaining**: Build a robust extraction-to-PDF text-span mapping, select the correct occurrence, navigate across all affected pages, and add tests for line breaks, page breaks, and duplicate text.
- [ ] **Partial**: DOCX citations show verified block excerpts and block ranges, but there is no rendered DOCX viewer with passage highlighting.

### 6. Multi-document questions

- [ ] **Remaining**: Allow several documents to be selected for one question.
- [ ] **Remaining**: Retrieve from only the selected owned document IDs.
- [ ] **Remaining**: Generate a comparative answer rather than separate per-document answers.
- [ ] **Remaining**: Verify every quote against its own document and include document name/ID in each citation.
- [ ] **Remaining**: Add UI controls for selection, loading, empty, partial, and error states.
- [ ] **Remaining**: Add tests for cross-document isolation and mixed evidence.

### 7. Document comparison

- [ ] **Remaining**: Add a comparison workflow for two document versions.
- [ ] **Remaining**: Segment documents by clause/paragraph and align corresponding sections.
- [ ] **Remaining**: Classify substantive changes separately from wording-only changes.
- [ ] **Remaining**: Generate a plain-language summary of each substantive change.
- [ ] **Remaining**: Support significance filtering and sorting.
- [ ] **Remaining**: Show both source versions and preserve traceability to each document.
- [ ] **Remaining**: Test monetary changes, moved liability caps, inserted/deleted clauses, reordered paragraphs, and formatting-only edits.

## Part C: selected challenge

The implementation plan chooses **Option 2: Agentic document research**.

- [ ] **Remaining**: Define strict tools such as `search_document`, `get_section`, and `list_clauses`.
- [ ] **Remaining**: Implement a real multi-round model/tool loop.
- [ ] **Remaining**: Stream tool activity to the UI, including what is being searched and why.
- [ ] **Remaining**: Enforce a configurable maximum number of rounds and a token/cost boundary.
- [ ] **Remaining**: Validate tool names and arguments; recover from malformed or invented tool calls without crashing.
- [ ] **Remaining**: Run the existing quote verification pipeline on the final answer.
- [ ] **Remaining**: Add a demo flow and document known limitations honestly.

Tracked-change redlining is not selected and should remain out of scope unless the Part C decision changes. Implementing both options would add unnecessary delivery risk.

## Quality, security, and operational work

- [x] **Done**: Keep AI configuration in environment variables; do not commit API keys.
- [x] **Done**: Scope document and vector access by authenticated owner/document filters.
- [ ] **Partial**: Focused backend tests now cover upload validation, PDF/DOCX extraction, scanned PDFs, and quote isolation; chat-stream, security, worker-recovery, and integration coverage remain.
- [ ] **Remaining**: Add adversarial/security tests for ID tampering, cross-user access, prompt injection in documents, malformed uploads, and stale vector isolation.
- [ ] **Done**: Frontend typecheck/build and backend syntax compilation pass in the current development environment. Full linting and clean-environment test execution remain operational follow-up work.
- [ ] **Remaining**: Test the deployed application with real PDF, DOCX, scanned PDF, long document, duplicate citation, and failed-provider scenarios.

## Submission checklist

- [ ] **Remaining**: Deploy the real working application and record the deployed URL.
- [ ] **Remaining**: Add screenshots for upload, chat with verified quotes, citation highlighting, and comparison.
- [ ] **Remaining**: Record a 3–5 minute demo covering upload, question, verification, citation navigation, comparison, and Part C work.
- [ ] **Remaining**: Update the README with accurate finished/unfinished status, screenshots, deployed link, demo link, setup steps, environment variables, worker requirements, and known limitations.
- [ ] **Remaining**: Write the short technical note covering quote verification/failure modes, large-document handling, Part C choice/progress, hardest problem, and next steps.

## Recommended implementation order

1. Remove the one-active-document restriction and complete the document library.
2. Make citation highlighting reliable for multi-line, cross-page, and duplicate quotes.
3. Build clause-level document comparison.
4. Build multi-document questions with per-document verified citations.
5. Implement the bounded agentic research loop and activity stream.
6. Add focused automated tests, then deploy and perform the complete demo validation.
