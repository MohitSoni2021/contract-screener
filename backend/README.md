# Elcara API

FastAPI backend for accounts and authenticated single-document ingestion. MongoDB stores account/document state, OpenAI creates embeddings, and Qdrant stores location-aware document chunks.

## Configure and start

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
cp .env.example .env
```

Set `MONGODB_URI`, `JWT_SECRET_KEY`, and `OPENROUTER_API_KEY` in `backend/.env`. Embedding and chat requests use the OpenAI Python SDK pointed at OpenRouter's OpenAI-compatible endpoint. `OPENROUTER_BASE_URL` defaults to `https://openrouter.ai/api/v1`; `OPENROUTER_EMBEDDING_MODEL` or the legacy `OPENAI_EMBEDDING_MODEL` defaults to `openai/text-embedding-3-small`; `OPENROUTER_CHAT_MODEL` or `OPENAI_CHAT_MODEL` defaults to `openai/gpt-4o-mini`. Change these to models supported by your provider account if needed. Ingestion limits are configurable with `MAX_PDF_PAGES` (default 600), `MAX_UPLOAD_BYTES` (25 MiB), `MAX_EXTRACTED_CHARACTERS` (3 million), and `MAX_EXTRACTED_TEXT_BYTES` (12 MiB). Start Qdrant at the configured `QDRANT_URL` (default `http://localhost:6333`), then run the API:

```bash
uvicorn main:app --reload --port 8000
```

In a second terminal, start one or more ingestion workers:

```bash
cd backend
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
python -m app.worker
```

Uploads are persisted as queued document records in MongoDB. Workers atomically claim jobs and renew a lease; if a worker dies, another worker can reclaim the job after the lease expires. Run workers with access to the same upload directory as the API. The MongoDB queue is a simple durable starter queue; for larger deployments, consider a dedicated broker and shared object storage.

The API checks MongoDB connectivity and creates user, token, and one-active-document indexes on startup. It creates the Qdrant collection on the first successful embedding batch. API docs are at `http://127.0.0.1:8000/docs`.

## Document lifecycle

- `POST /api/documents` — authenticated multipart upload; accepts PDF/DOCX up to the configured upload limit and returns a queued document record immediately.
- `GET /api/documents/current` — returns the authenticated user's active document, if any.
- `GET /api/documents/{document_id}` — returns extraction/indexing stage and progress, scoped to the owner.
- `GET /api/documents/{document_id}/conversations` — lists saved chats for the active document.
- `GET /api/conversations/{conversation_id}` — reopens one saved conversation for its owner.
- `POST /api/chat/stream` — retrieves owner/document-scoped passages, streams the answer as SSE, and saves the exchange.
- `GET /api/documents/{document_id}/file` — serves the original file to its authenticated owner for source navigation.
- `DELETE /api/documents/{document_id}` — removes the finished or failed document and its Qdrant vectors.

PDF extraction preserves page numbers; DOCX extraction reads paragraphs and tables. Canonical extracted text is retained for citation checks. Text is chunked with overlap and indexed in embedding batches. Each vector carries the server-derived `owner_id`, `document_id`, source offsets, and page/block locations. `document_scope()` is the central owner-and-document filter for vector operations. The UI polls status and restores the active document after refresh.

Chat embeds each question, retrieves up to six passages using both the authenticated owner and active document filter, then streams an answer over Server-Sent Events through the OpenAI SDK configured for OpenRouter. Conversation turns and verified citation excerpts are saved in MongoDB. A citation is shown only when its Qdrant passage matches the canonical extracted source text at its stored offsets after whitespace normalization. Clicking a PDF source opens the original file at the cited page and displays the verified passage; DOCX sources show their verified block passage.

The first release supports text-based PDFs and DOCX files. It rejects PDFs without extractable text with an OCR guidance message. Defaults are 25 MiB upload, 600 PDF pages, 3 million extracted characters, and 12 MiB of extracted UTF-8 text. PDF page count is checked before extracting text; extraction runs off the API event loop and stops as soon as an extracted-text cap is crossed. Chunk-to-source mapping advances through source blocks rather than rescanning every block for every chunk. A MongoDB-backed worker queue uses atomic claims and expiring leases to recover jobs after worker crashes. Extraction and chunk construction are still bounded in memory by configured text limits; the original upload path is local, so multi-host workers need a shared mounted volume until object storage is added.

## Authentication routes

- `POST /api/auth/register` — `{ "name", "email", "password" }`; stores a normalized email and Argon2 password hash.
- `POST /api/auth/login` — `{ "email", "password" }`.
- `GET /api/auth/me` — requires `Authorization: Bearer <token>`.
- `POST /api/auth/logout` — revokes the current token until it expires.

## Current limitations

Semantic retrieval is bounded to the six highest ranked chunks; it cannot prove that a clause is absent from a large document. PDF citations open the cited page and highlight matching text-layer spans; the verified quote remains visible beside the viewer because PDF text segmentation can differ from the extracted passage. DOCX citations show the verified excerpt and block location without an in-browser DOCX renderer. The starter queue has no separate broker, automatic retry policy for application-level failures, or object storage; workers must share the API's upload filesystem. OCR, email verification, password reset, rate limiting, refresh tokens, and production cookie sessions are also not implemented. The frontend keeps its access token in localStorage. Keep `.env` out of Git, use a least-privilege MongoDB user, and restrict MongoDB/Qdrant network access before deployment.
