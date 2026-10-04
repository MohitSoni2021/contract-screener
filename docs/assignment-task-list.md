# Hiring assignment coverage

This checklist compares the current repository implementation with the supplied engineering assignment. It is a code inventory, not a claim that every path has been validated against the evaluator's documents or deployment environment.

Legend: **Implemented** means a code path exists; **Partial** means meaningful behavior exists with a material gap; **Not implemented** means the feature is absent in the current app.

## Part A: Core features

| Requirement | Status | Current behavior and limits |
| --- | --- | --- |
| PDF/DOCX upload and reject other types | Implemented | Checks extension, signature, empty files, upload size, document quota, and PDF page limit. |
| Extract and store text | Implemented | Extracts PDF text blocks and DOCX paragraphs/tables; stores canonical text and source block metadata. No OCR. |
| Processing progress and scanned PDF feedback | Implemented | Queued worker stages and percentages are visible; empty-text documents fail with a scanned-PDF/OCR message. |
| Document library, open, and delete | Implemented | Authenticated document list and source viewer; delete cleans up associated stored data and index where available. |
| Streamed chat and stop | Implemented | Chat uses SSE token events; active messages can be cancelled while retaining partial output. |
| Conversation history by document | Implemented | Conversations and messages are saved in MongoDB and can be listed/reopened. Context sent to a response is bounded. |
| Verified quotes | Implemented | Citations are checked against canonical extracted text and source positions are computed by the server. Unsupported responses are constrained by evidence. |
| Large-document handling | Partial | Chunked extraction/indexing, up to 600 PDF pages, bounded retrieval, and broad-mode coverage reporting exist. Actual success also depends on file and text-size limits, provider limits, timeouts, and source quality. |

## Part B: Advanced features

| Requirement | Status | Current behavior and limits |
| --- | --- | --- |
| Citation highlighting | Partial | PDF.js text-layer matching and DOCX extracted-text highlighting exist. PDF text splitting, duplicate wording, and DOCX pagination can make visual locations approximate. |
| Multi-document questions | Partial | Comparative chat accepts two documents and verifies citations per source. A separate agent endpoint accepts up to five documents, but the current user-facing research page selects one document and there is no general multi-document chat workflow. |
| Document comparison | Implemented | Section-level matching, change categories, summaries, and a question interface across a pair are present. Compare alignment and legal-impact explanations need source review. |

## Part C: selected challenge

**Selected option: Agentic document research.** A bounded model/tool loop is implemented with search and document-inspection tools, a visible trace, argument validation, repeated-call handling, round/token bounds, and quote verification. The final synthesis is emitted after the loop rather than streamed token-by-token. Tool matching and clause identification rely on extracted text and heuristics.

Tracked-change redlining also exists as a separate feature, but the research option is the documented Part C selection. Redlining from PDF cannot preserve the original page layout; see [advanced features](advanced-features.md).

## Product and account notes

- The assignment assumes a single user and says login is not needed. The current app has ownership-scoped bearer authentication as a product extension.
- The current API has no public registration endpoint; the UI's `/register` route redirects to sign-in. Provisioning/demo behavior should be replaced before public launch.
- The default active document quota is three per account.
- Default PDF page limit is 600; independent upload and extracted-text caps can still reject a book-sized PDF.

## Submission checklist

The assignment asks for a repository link, working deployed link, README screenshots, a 3–5 minute demo, and a short implementation note. This repository documentation does not imply these external deliverables have been created. Record links and add real screenshots after the deployed application and demo are ready.

Suggested demo sequence:

1. Upload a PDF or DOCX and show processing progress.
2. Ask a focused question and show the streaming answer and verified citation.
3. Open the cited location in the document viewer.
4. Compare two contract versions and inspect a substantive change.
5. Show the research tool trace and explain its bounded behavior and known gaps.
