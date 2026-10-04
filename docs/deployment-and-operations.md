# Deployment and operations

## Services

The production topology needs:

1. A static frontend host for the Vite build.
2. A Python host running the FastAPI app.
3. MongoDB for account, document, conversation, and file records.
4. Qdrant for vector search.
5. An OpenRouter key and models that support embeddings, streaming chat, and tool calling for research.

Local development uses Docker Compose for Qdrant. Hosted deployments should use managed MongoDB and Qdrant endpoints with TLS and server-side credentials. The storage service can read from an optional private object store as a fallback, but upload currently writes original bytes to MongoDB GridFS.

## Build and launch

Frontend production build:

```bash
cd frontend
npm ci
npm run build
```

The static output is `frontend/dist`. Configure the host with the SPA fallback to `index.html` and set `VITE_API_BASE_URL` to the deployed API origin at build time.

Backend entrypoint:

```bash
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000
```

The FastAPI lifespan validates MongoDB connectivity, creates indexes, and starts an ingestion worker loop. If the API is scaled to multiple processes or replicas, each process may run a loop; MongoDB leases coordinate which worker owns a document. Monitor lease expiry, duplicate work, API memory, and provider concurrency when scaling.

## Environment variables

| Variable | Required | Default or use |
| --- | --- | --- |
| `MONGODB_URI` | Yes | MongoDB connection string |
| `MONGODB_DATABASE` | No | `elcara` |
| `JWT_SECRET_KEY` | Yes | JWT signing key; use a strong random secret |
| `JWT_ACCESS_TOKEN_MINUTES` | No | `60`; allowed range 5–1,440 |
| `CORS_ORIGINS` | No | Comma-separated browser origins; the default includes local development origins |
| `OPENROUTER_API_KEY` | For AI features | OpenRouter credential used by the OpenAI SDK client |
| `OPENROUTER_BASE_URL` | No | `https://openrouter.ai/api/v1` |
| `OPENROUTER_CHAT_MODEL` | No | `openai/gpt-4o-mini` |
| `OPENROUTER_EMBEDDING_MODEL` | No | `openai/text-embedding-3-small` |
| `OPENAI_CHAT_MODEL` | Legacy fallback | Used only when the OpenRouter model variable is empty |
| `OPENAI_EMBEDDING_MODEL` | Legacy fallback | Used only when the OpenRouter model variable is empty |
| `QDRANT_CLUSTER_ENDPOINT` | No | Preferred Qdrant Cloud endpoint |
| `QDRANT_URL` | No | `http://localhost:6333`; used when cloud endpoint is empty |
| `QDRANT_API_KEY` | For protected Qdrant | Qdrant Cloud or secured server key |
| `QDRANT_TIMEOUT_SECONDS` | No | `30`; allowed range 1–300 |
| `QDRANT_COLLECTION` | No | `document_chunks` |
| `MAX_UPLOAD_BYTES` | No | `15728640` (15 MiB) |
| `MAX_PDF_PAGES` | No | `600`; allowed range 1–10,000 |
| `MAX_DOCUMENTS_PER_USER` | No | `3`; allowed range 1–1,000 |
| `MAX_EXTRACTED_CHARACTERS` | No | `3000000` |
| `MAX_EXTRACTED_TEXT_BYTES` | No | `12582912` (12 MiB) |
| `RESEARCH_MAX_ROUNDS` | No | `8`; server clamps to 1–8 |
| `RESEARCH_MAX_TOKENS` | No | `3200`; server clamps to 500–12,000 |
| `SUPABASE_URL` | No | Optional private storage fallback endpoint |
| `SUPABASE_SERVICE_ROLE_KEY` | No | Optional server-side storage credential |
| `SUPABASE_BUCKET` | No | `documents` |
| `VITE_API_BASE_URL` | Hosted frontend | API origin embedded into the Vite build |

The current app config also has a production API fallback in the frontend. Set `VITE_API_BASE_URL` explicitly for each deployment rather than relying on that fallback.

## Data and backups

- Back up MongoDB, including GridFS collections, document canonical text, account metadata, conversations, and messages.
- Back up or plan to rebuild Qdrant. Vectors can be recreated from stored files and configured embedding models, but reindexing incurs time and provider cost.
- Keep the embedding model and vector dimension consistent with the active Qdrant collection. A model dimension mismatch requires a new collection or a controlled rebuild.
- Test deletion and restore procedures with non-production data.
- Establish retention and deletion policies for source files, derived vectors, messages, logs, and backups.

## Observability

Monitor API health, MongoDB connectivity, Qdrant latency/errors, worker lease age, document stage duration, provider errors and rate limits, upload rejection counts, and failed documents. Avoid writing document contents or secrets to logs. The health endpoint currently checks process availability only; add dependency readiness checks for production monitoring if the host needs them.
