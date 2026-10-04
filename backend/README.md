# Backend guide

Elcara's backend is a FastAPI service. It authenticates requests, manages document records and original files, extracts text, creates embeddings, writes and searches Qdrant, streams chat responses, verifies citations, and implements document comparison, research, and redlining endpoints.

## Run the API

From this directory:

```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

Configure `MONGODB_URI`, `JWT_SECRET_KEY`, and `OPENROUTER_API_KEY`. Start Qdrant separately, then run:

```bash
uvicorn main:app --reload --port 8000
```

The FastAPI lifespan initializes MongoDB indexes and starts the ingestion worker loop in the API process. `/api/health` is a lightweight liveness endpoint; `/docs` is FastAPI's interactive OpenAPI page.

## Configuration

All settings are read from environment variables, with `.env` loaded from this directory during local development. See [the environment reference](../docs/deployment-and-operations.md#environment-variables).

The OpenAI SDK is initialized with `OPENROUTER_BASE_URL` and `OPENROUTER_API_KEY`. Model selection uses `OPENROUTER_CHAT_MODEL` and `OPENROUTER_EMBEDDING_MODEL`; legacy `OPENAI_CHAT_MODEL` and `OPENAI_EMBEDDING_MODEL` values are fallbacks. The SDK is the provider interface, while the default configured provider is OpenRouter.

## API groups

| Prefix | Purpose |
| --- | --- |
| `/api/auth` | Sign in, inspect current account, sign out |
| `/api/documents` | Upload, list, inspect, retrieve, process, compare versions, and delete documents |
| `/api/chat` and `/api/conversations` | Stream and manage document conversations |
| `/api/chats` | Compatibility routes for chat retrieval, message streaming, cancellation, and deletion |
| `/api/citations` | Retrieve a verified citation from a user's chat history |
| `/api/research` | Bounded multi-round document research and tool trace |
| `/api/compare` | Analyze and ask questions across two document versions |
| `/api/redline` | Propose edits and return a DOCX with tracked changes |

Request schemas and response examples are documented in [the API reference](../docs/api-reference.md). Runtime OpenAPI at `/docs` is the definitive contract for the checked-out version.

## Processing lifecycle

Uploads are stored in MongoDB GridFS and represented by an active document record. The API starts background processing after accepting an upload; the worker's lease and heartbeat fields allow a claim to be recovered if a process stops. The pipeline extracts canonical text, creates location-aware chunks and structure metadata, requests embeddings in batches, and upserts points to Qdrant. Progress is persisted on the document record and exposed through the document status route.

If extraction, embedding, or indexing fails, processing is marked failed and the document's vectors are cleaned up where possible. A document is chat-ready only after the index is marked ready.

## Important implementation constraints

- Public registration is not currently implemented. The frontend `/register` route redirects to sign-in.
- Document and vector operations must use the server-resolved user ID and document ID.
- PDF and DOCX extraction produces text and location anchors; it does not perform OCR.
- Broad and contents questions have separate retrieval modes; they do not use the same query path as focused questions.
- The bounded agent research route streams tool activity and emits its final answer after the bounded loop.
- Current document limits and defaults are listed in the root README and configuration reference.

## Development checks

The repository has pytest coverage for extraction, storage, and core document flows. Run the relevant checks after backend changes:

```bash
pytest
```

Tests that need MongoDB, Qdrant, or provider access should be configured for those services. Keep credentials in local environment files and never place them in test fixtures or documentation.
