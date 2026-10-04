# Product overview

## Purpose

Elcara helps a person understand legal agreements by keeping the source document, questions, answers, and citations together. Its central product promise is that an answer should be supported by text from the selected contract, and that a displayed source quote must be checked against the extracted source text.

## Main workflows

### Read and ask

Upload a PDF or DOCX, wait for the extraction and index status to become ready, then open its chat. Ask a focused question for a passage-level answer, a broad question for document-wide evidence, or a contents question for the extracted outline. Answers stream as they are generated. The user can stop a response and reopen saved conversations.

### Inspect a citation

Each citation identifies a verified quote and its source location. Selecting it opens the source viewer at the related PDF page or DOCX text block and attempts to highlight the matching text. PDF highlighting works over the rendered text layer; visual fidelity depends on how the PDF's text is encoded and split by its renderer.

### Compare agreements

Select two ready documents to produce a section-level comparison and ask a question across the pair. The comparison report categorizes additions, deletions, wording changes, and substantive differences. AI explanations are assistance for review; they are not legal advice and should be checked against both original documents.

### Research and redline

Agent research lets the model call a limited set of document tools over several rounds while the UI shows its activity. Redlining proposes replacement text and returns a DOCX with tracked insertions and deletions. Users should review every proposed edit before using it.

## Current product constraints

- Supported source types: PDF and DOCX.
- Default limits: 15 MiB upload, 600 PDF pages, three active documents per user, three million extracted characters, and 12 MiB extracted text.
- Scanned, image-only PDFs are rejected when no readable text is found; OCR is not provided.
- DOCX page numbers are not stable in the extraction model, so citations use block locations.
- The current login UI has no public registration workflow; `/register` redirects to sign-in.
- Comparison operates on two documents at a time.
- Agent research is bounded and can only reason from text it has read through its tools.
- A generated redline from a PDF uses extracted text to create a new DOCX and cannot preserve the PDF's original layout.

## Intended users

The product is designed for people who need to review and understand contracts. It is a reading and analysis aid. Users remain responsible for confirming that the source supports an answer and for getting qualified legal advice where needed.
