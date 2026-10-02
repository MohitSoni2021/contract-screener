# Elcara Contract Q&A

A document-grounded contract analysis app. A user uploads one PDF or DOCX per account; the Python API extracts text, creates embeddings and streamed answers through the OpenAI SDK configured for OpenRouter, and indexes private chunks in Qdrant.

## Project scope

The hiring assignment assumes a single user and explicitly says no account system is needed. The product direction asks for login and user-specific documents, so the app includes registration/login and scopes uploads and chats to the authenticated user. MongoDB enforces one active document per account.

## Proposed stack

- Python API: FastAPI
- Document extraction: PyMuPDF (PDF) and python-docx (DOCX)
- Vector database: local Qdrant Docker container
- Document/account metadata: MongoDB
- AI: OpenAI SDK routed through OpenRouter for embeddings and streamed answers. Parsing, chunking, persistence, Qdrant indexing, retrieval, access checks, and quote validation stay in the application.
- Browser UI: Vite + React + TypeScript with React Router; consume chat events over Server-Sent Events (SSE).

## User experience

1. Upload one PDF or DOCX. Show validation and processing progress; reject other types and report scanned PDFs with no extractable text.
2. Ask document questions, stream answers, stop generation, reopen saved conversations, and inspect source passages verified against the extracted text.
3. Show source quotes only after server-side verification. Selecting a verified quote opens the cited PDF page and highlights matching source text in its rendered text layer; DOCX sources show the verified block excerpt.
4. Reopen conversation history for the document. Replace or delete the document and its index explicitly.

## Data flow

```text
PDF/DOCX upload
  -> validate size/type and assign document_id + owner_id
  -> queue document metadata in MongoDB for a leased ingestion worker
  -> preflight page count and extract within configured text limits
  -> normalize and split into overlapping, location-aware chunks
  -> OpenAI embeddings -> Qdrant upsert with ownership and location payload
  -> persist document metadata and processing status in MongoDB

Question
  -> authenticate/resolve owner on server
  -> validate owner owns the active document
  -> embed question -> Qdrant search with mandatory owner_id + document_id filter
  -> combine retrieved evidence with recent conversation turns
  -> OpenAI streamed answer with evidence references
  -> verify every proposed quote against canonical extracted text
  -> emit answer and verified citations to browser as SSE events
```

## Starter scaffold

The repository includes a Vite + React + TypeScript frontend in `frontend/` and a FastAPI backend in `backend/`. The frontend proxies `/api` calls to the API during development. Registration, login, session restore/logout, authenticated PDF/DOCX upload, extraction, chunking, OpenRouter embeddings through the OpenAI SDK, owner-filtered Qdrant indexing, streamed document chat, conversation history, and citation source checks are implemented. Citation selection opens the cited PDF page in a text-layer viewer and highlights matching source text, with the verified quote displayed alongside it.

### Start the API

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

In another terminal, run the MongoDB-backed ingestion worker with `python -m app.worker` from `backend/`. The worker claims queued documents with expiring leases; configure the limits in `backend/.env` (`MAX_PDF_PAGES=600`, `MAX_UPLOAD_BYTES=26214400`, `MAX_EXTRACTED_CHARACTERS=3000000`, `MAX_EXTRACTED_TEXT_BYTES=12582912`). API and worker must share the upload directory.

### Start the frontend

In another terminal:

```bash
cd frontend
npm install
npm run start
```

Tailwind CSS v3 is configured through `tailwind.config.js` and `postcss.config.js`; directives are in `src/index.css`. Use Node.js 20.19+ or 22.12+ for the current Vite release.

The React frontend uses React Router DOM: `/login` and `/register` render the authentication pages, while `/workspace` is protected and requires a valid session. Route components live in `frontend/src/pages/`; shared UI lives in `frontend/src/components/`.

### Configure and start the backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
cp .env.example .env
uvicorn main:app --reload --port 8000
```

Set `MONGODB_URI`, `JWT_SECRET_KEY`, and `OPENROUTER_API_KEY` in `backend/.env`. `OPENROUTER_CHAT_MODEL` and `OPENROUTER_EMBEDDING_MODEL` can select models; the defaults are documented in the backend guide. Keep `.env` out of source control. Authentication and chat route details and limitations are in [`backend/README.md`](backend/README.md). The assignment PDF is included in this folder as `hiring assignment.pdf`.

Do not commit `.env` files or API keys. The assignment PDF is included in this folder as `hiring assignment.pdf`.

## Requirements and delivery checklist

The evaluation asks for PDF/DOCX upload, extraction and status, a document library, streaming/cancellable chat, per-document history, verified quotes, large-document behavior, citation highlighting, multi-document questions, clause-level comparison, and one Part C challenge. Current implementation covers authentication, single-document extraction/indexing, streamed single-document chat, conversation history, verified source passages, and PDF text-layer citation highlighting. Multi-document questions, comparison, and the selected Part C option are still planned. The implementation sequence and chosen Part C option are described in `docs/implementation-plan.md`.

The submission also needs screenshots, a deployed link, and a 3–5 minute demo video. Add those only when they exist.

## Documentation

- [Architecture and isolation](docs/architecture.md)
- [Data model](docs/data-model.md)
- [Implementation plan](docs/implementation-plan.md)
