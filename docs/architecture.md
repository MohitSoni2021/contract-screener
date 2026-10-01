# Architecture and retrieval isolation

## Boundaries

The Python API owns identity, document lifecycle, extraction, chunking, vector indexing, authorization, retrieval, history, streaming orchestration, and citation verification. Qdrant stores chunk vectors and retrieval payload. SQLite/PostgreSQL stores durable document state, ownership, processing status, and chat history. OpenAI is an external model service used for embeddings and answer generation; it is not the source of truth for documents, access control, or citation locations.

## One-document-per-user rule

Represent the uploaded source as a `document` record with a stable `document_id` and an `owner_id`. Enforce one active document per owner with a database constraint or transactional check. Replacing a document is an explicit operation: deactivate/delete the old document, its chunks, and associated index, then activate the new document. Keep prior chat history only if product policy requires it; do not accidentally attach an old conversation to a replacement document.

The current app derives `owner_id` from a verified bearer token on the server. Never accept an owner ID from a form field, URL parameter, or chat payload as authorization. This differs from the assignment's stated single-user scope, which does not require accounts.

## Authentication in the starter

Registration normalizes email addresses, enforces a unique email index, and stores an Argon2 password hash. Login returns a signed, one-hour JWT. Authenticated endpoints verify the signature, issuer, audience, expiry, user record, and revocation status. Logout revokes the active token until its expiration; a MongoDB TTL index removes expired revocation records. The current browser client stores its access token in `localStorage` and restores it through `/api/auth/me`.

Email verification, password recovery, rate limiting, refresh tokens, and secure HTTP-only cookie sessions are not implemented. The local starter uses a MongoDB URI from the ignored backend `.env` file; use a least-privilege database user and a deployment secret store outside local development.

## Qdrant layout and isolation

Use a shared collection (for example, `document_chunks`) with one point per chunk. Each point has:

```json
{
  "document_id": "opaque-document-id",
  "owner_id": "server-resolved-owner-id",
  "chunk_id": "opaque-chunk-id",
  "text": "chunk text",
  "page_start": 12,
  "page_end": 13,
  "char_start": 45210,
  "char_end": 47890,
  "ordinal": 42,
  "active": true
}
```

Create Qdrant payload indexes for `owner_id`, `document_id`, and `active`. Every search, scroll, update, and delete must scope by server-resolved `owner_id` AND the selected `document_id` (and `active=true` when applicable). Validate ownership in the relational database before querying Qdrant. Construct the Qdrant filter centrally in one repository function; do not let endpoint callers omit it. A document-specific filter is required even when each user can have only one active document, to prevent stale or orphaned chunks from leaking into retrieval.

The shared collection scales more simply than creating a collection per user. If stronger isolation is later required, use a collection per tenant or separate Qdrant instances, while keeping the same ownership checks in the API. Payload filters are defense-in-depth, not a replacement for authorization.

## Ingestion

1. Check extension and MIME signature; enforce an upload size/page limit and generate opaque IDs and a safe stored filename.
2. Extract PDF text with page boundaries and DOCX paragraphs/tables with stable block indices. Keep a canonical extracted representation with location mapping.
3. If extraction returns no meaningful text (for example, scanned image-only PDF), mark processing as failed with an actionable message. Do not index an empty document as success. OCR is out of initial scope unless explicitly added.
4. Normalize whitespace for indexing while preserving canonical text and source locations. Chunk by paragraph/sentence boundaries with overlap; store offsets/locations for navigation.
5. Generate embeddings in batches through the OpenAI SDK and upsert points with owner/document payload. Record the embedding model and dimensions in configuration; collection dimensions must match.
6. Mark the document ready only after all chunks are indexed. Make ingestion idempotent using deterministic point IDs or a replaceable index version. On failure, clean partial points or keep the prior active index intact.

## Question answering and history

Resolve the owner and document from authenticated server state. Confirm the document is active and owned before any vector query. Embed the question, retrieve a bounded set of relevant chunks with the mandatory Qdrant filter, and send only those evidence passages plus a bounded amount of conversation history to the model. Persist each user turn and assistant output against both `conversation_id` and `document_id`.

Conversation history helps resolve follow-ups but is not evidence. The current turn's answer must cite retrieved document chunks. If evidence is insufficient, answer that the document does not establish the requested fact. For claims of absence across a large document, use a deliberate coverage strategy (for example, section/clause inventory or broader staged retrieval); top-k vector search alone cannot prove a clause is absent.

Stream Server-Sent Events with explicit event types such as `status`, `token`, `citation`, `done`, and `error`. Use a request-scoped cancellation token. On cancellation, stop generation where possible and persist the partial answer with a cancelled status. Avoid starting a second generation for a retry unless the user explicitly retries.

## Verified citations and navigation

Ask the model for structured claims and candidate quotes tied to retrieved chunk IDs. Treat IDs, page numbers, and offsets returned by the model as untrusted. For each candidate, resolve the chunk on the server, locate the quote in that chunk's canonical source text using whitespace-normalized matching, and compute the location from the stored source map. If the quote cannot be found, remove it or label it unverified; never present it as a source quote. Prefer exact source text in the UI after locating a normalized match.

For PDF highlighting, map extracted page text offsets back to rendered-page text positions or use a PDF text-layer viewer that exposes text spans. For DOCX, map paragraph/table block indices to rendered page locations only if pagination is stable; DOCX pagination can vary by renderer. Handle repeated quote occurrences by choosing the occurrence associated with the cited chunk and provide context. A citation spanning pages should carry multiple locations or a page range.

## Environment configuration (proposed)

```dotenv
OPENAI_API_KEY=
OPENAI_BASE_URL=
OPENAI_EMBEDDING_MODEL=
OPENAI_CHAT_MODEL=
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=
DATABASE_URL=sqlite:///./elcara.db
APP_AUTH_MODE=single_user
```

Keep secrets in local environment or deployment secret storage. Do not commit keys. Pin the embedding model/dimensions for a collection; changing the embedding model requires re-embedding all indexed chunks.

## Operational and privacy notes

Set request, file, page, token, retrieval, and model-round limits. Apply rate limits in authenticated mode. Delete the document's Qdrant points and relational records through an idempotent lifecycle operation. Log opaque IDs and processing outcomes, not full document contents or API secrets. For multi-tenant deployment, test every read, update, and delete path for cross-owner access, including guessed IDs and stale vector points.
