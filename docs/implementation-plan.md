# Roadmap and known limitations

This page is the forward-looking plan based on the current repository state. It distinguishes completed code paths from work needed to make the product safer and more reliable for a public release.

## Current baseline

- React/TypeScript client with protected workspace, chat, comparison, research, and redline pages.
- FastAPI backend with bearer authentication, MongoDB documents and conversation history, GridFS source files, and Qdrant vector indexing.
- PDF/DOCX extraction, chunking, background ingestion progress, focused chat, document-wide and contents retrieval, citation checks, and source viewers.
- Two-document comparison chat and section-level report.
- Agentic document research with bounded tools and source checks.
- DOCX tracked-change generation.
- Project documentation and local setup guide.

See [assignment coverage](assignment-task-list.md) for feature-level status and gaps.

## Recommended next work

### 1. Replace demo access with a real account lifecycle

Add explicit account creation, email verification or another controlled provisioning path, password recovery, abuse protection, and a production session strategy. Remove fixed demo account behavior from source before public deployment. This is the most important known product-readiness issue.

### 2. Validate end-to-end behavior on representative files

Use text-based PDFs, scanned PDFs, DOCX files with tables, long contracts, duplicate clauses, multi-page citations, and two contract versions. Record actual processing time, extraction coverage, provider calls, and failure states. Verify the current upload/text caps are acceptable for target workloads.

### 3. Improve ingestion durability and operations

Run the worker as a separately supervised deployment role when scaling the API. Add queue depth, retry/backoff policy, dead-letter handling, processing metrics, readiness checks for MongoDB/Qdrant, and explicit reindex controls. Review cleanup behavior after partial Qdrant writes and storage failures.

### 4. Improve document-wide synthesis

Current broad mode scrolls and verifies indexed chunks, then selects at most 18 distributed passages. It reports partial coverage when all chunks are not supplied. A stronger solution is a versioned hierarchy of section summaries built from bounded chunk batches, with each summary retaining source chunk references. Use that hierarchy for broad questions and keep citations attached to original passages. The contents extractor should also evolve from heuristics to robust structure detection with a visible confidence/coverage state.

### 5. Strengthen source location and evaluation

Improve PDF quote-to-render mapping for text spans split or repeated on a page. Define a stable DOCX viewer or conversion strategy for page-like navigation. Add a representative offline evaluation set for retrieval recall, quote validity, unsupported questions, broad coverage, and comparison classifications.

### 6. Complete product delivery materials

Add genuine screenshots, a deployed URL that has been checked, a 3–5 minute demo video, and the short technical note requested by the assignment. Avoid claiming unsupported features or results.

## Design principles for future changes

- Keep MongoDB as the source of truth and Qdrant as a rebuildable derived index.
- Apply owner and document scoping in every read, search, update, and delete.
- Keep citation verification server-side and based on canonical extracted text.
- Make incomplete extraction and retrieval coverage visible to the user.
- Bound file work, model context, tool rounds, and retry behavior.
- Store provider and database credentials only in server-side secret configuration.
