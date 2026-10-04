# Advanced features

## Document comparison

The comparison workspace accepts two distinct ready documents owned by the current user. It extracts canonical text, identifies sections, aligns corresponding passages, and returns changes categorized as substantive, wording, formatting, inserted, deleted, moved, or unchanged where supported by the comparison pipeline. The report includes a summary and section-level explanations.

The compare chat route combines retrieved chunks from both sources with detected changes. Citation candidates carry a document ID and are verified against that document independently. Comparison is a review aid: alignment heuristics and model explanations can miss context, and material changes should be checked against the originals.

API routes:

- `POST /api/compare` with `leftDocumentId` and `rightDocumentId` returns a report.
- `POST /api/compare/chat` adds a question and returns a comparative answer with source citations.
- `POST /api/documents/compare` is a document-version comparison route using `old_document_id` and `new_document_id`.

## Agentic document research

The research workspace runs a bounded model/tool loop over one selected document. The separate `/api/agent/research` endpoint accepts between one and five owned documents; the current research page uses the single-document research flow. The model may search text, inspect a bounded section, list clause-like headings, read definitions, or inspect a page, depending on the active tool schema. Tool names and arguments are checked server-side. Repeated calls are suppressed and the round count is capped.

The interface streams status and tool activity while the loop runs. The final synthesis follows the research loop, and proposed source quotes are checked against canonical text. Research does not include the full document in every prompt and must not infer that a topic is absent merely because a search tool returned no match.

See [Agentic research](agentic-research.md) for the demo flow, configured bounds, and known limitations.

## Tracked-change redlining

The redline workspace accepts an instruction, asks the model to propose targeted edits, and lets the user stage or apply selected edits. Applying returns a DOCX attachment with WordprocessingML deletion and insertion elements that Word or LibreOffice can display as revisions.

For an existing DOCX, the service attempts to update the original package in place so existing formatting is better preserved. If that fails, it creates a new DOCX from extracted text. For a PDF source, it always creates a DOCX from extracted text; original page design and typography cannot be preserved. Target matching may fail when a phrase appears more than once or is split across document runs. Review the exported file in an office editor and accept/reject each revision there.

API routes:

- `POST /api/redline` with `documentId` and `instruction` proposes edits.
- `POST /api/redline/apply` with `documentId` and an `edits` array returns the tracked-change DOCX.

## Limits shared by advanced features

All documents must be owned by the signed-in user and ready for processing. Model output is fallible. Verified source quotes confirm the quoted words exist in extracted text, but do not constitute legal advice or validate the interpretation of a change.
