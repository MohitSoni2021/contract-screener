# Document processing

## Supported files

The upload accepts files with a `.pdf` or `.docx` extension and checks a file signature before saving. Empty files, unsupported formats, invalid signatures, oversized files, and per-account document-limit violations are rejected with an HTTP error and a user-readable message.

The original file is stored in MongoDB GridFS. The document record is created with `queued` status and returned with HTTP `202 Accepted`. A worker processes it asynchronously and writes stage, percentage, and indexed-passage progress to MongoDB.

## Processing stages

1. **Queued:** The upload is saved and waits for a worker claim.
2. **Extracting:** PDF pages or DOCX paragraphs/tables are converted into text blocks with location metadata.
3. **Chunking:** Canonical text is stored and split into overlapping spans. Heading and contents metadata are derived from extracted text.
4. **Embedding:** Chunks are sent in batches to the configured embedding model through the OpenAI SDK/OpenRouter.
5. **Indexing:** Vector points and metadata are upserted to Qdrant.
6. **Ready:** All required points have been written and the document can be queried.
7. **Failed:** Processing stopped; the document response includes the reason where available.

The worker stores a lease and periodically renews it. Another worker may reclaim a document after its lease expires, supporting recovery after restarts. The API lifespan starts a worker loop automatically in the current deployment shape.

## Extraction details

- **PDF:** PyMuPDF extracts text blocks in page order. Each block records its page and block number. Page count is checked before text extraction. Image-only scans do not contain searchable text to this pipeline and fail with an OCR guidance message.
- **DOCX:** `python-docx` extracts paragraph and table text in document order. Block indices are preserved; page layout is not stable until rendered in an office application.
- The canonical extracted text is stored in MongoDB and used for quote verification. Qdrant is treated as a derived retrieval index.
- Structure extraction uses heading and contents heuristics; it is not a document layout or table-of-contents parser with guaranteed accuracy.

## Chunking and vectors

The current chunker targets 3,600 characters with 450 characters of overlap and prefers newline/space boundaries. It records character offsets and the page/block range of the source blocks intersecting each chunk. Ingestion requests embeddings in batches of 64.

Each Qdrant point stores one chunk vector and payload fields for owner, document, active state, index version, chunk ordinal, text, and source offsets. Every retrieval is filtered by the server-derived owner and document IDs.

## Default limits

| Setting | Default | Notes |
| --- | ---: | --- |
| `MAX_UPLOAD_BYTES` | 15 MiB | Upload size ceiling |
| `MAX_PDF_PAGES` | 600 | PDF page count ceiling |
| `MAX_DOCUMENTS_PER_USER` | 3 | Active documents per account |
| `MAX_EXTRACTED_CHARACTERS` | 3,000,000 | Character ceiling across extracted text |
| `MAX_EXTRACTED_TEXT_BYTES` | 12 MiB | Leaves margin under MongoDB's BSON document size limit |
| `EMBEDDING_BATCH_SIZE` | 64 chunks | Defined by the ingestion service |

Settings can be raised within code-enforced bounds. Increasing a limit increases extraction time, memory pressure, provider usage, indexing work, and storage. Raising only the page limit does not guarantee a file can pass the independent upload and extracted-text limits.

## Failure handling

If extraction produces no text, the document fails instead of becoming an empty ready document. If embeddings or Qdrant writes fail, processing is marked failed and the worker attempts to delete partial vectors. Check API logs, MongoDB connectivity, Qdrant connectivity, provider configuration, and the document's persisted error before retrying.

The UI polls the document status endpoint while processing. It should show the current stage, percentage, and failure detail; a failed record can be deleted before a fresh upload.
