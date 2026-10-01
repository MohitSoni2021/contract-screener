# Elcara Contract Q&A

A document-grounded contract analysis app. A user uploads a PDF or DOCX, asks questions in a streaming chat, and receives answers supported by quotes that the server verifies against the source document.

## Project scope

The hiring assignment assumes a single user and explicitly says no account system is needed. The product direction in this brief asks for login and user-specific documents, so the current starter includes registration/login and scopes uploads to the authenticated user. This is a deliberate change from the assignment's suggested scope; the current upload endpoint does not yet enforce one document per account.

## Proposed stack

- Python API: FastAPI
- Document extraction: PyMuPDF (PDF) and python-docx (DOCX)
- Vector database: local Qdrant Docker container
- Relational metadata and chat history: SQLite for local MVP; PostgreSQL for deployment
- AI: OpenAI SDK for embeddings and answer generation only. Parsing, chunking, persistence, Qdrant indexing, retrieval, access checks, and quote validation stay in the application.
- Browser UI: Next.js or a small server-rendered frontend; consume chat events over Server-Sent Events (SSE).

## User experience

1. Upload one PDF or DOCX. Show validation and processing progress; reject other types and report scanned PDFs with no extractable text.
2. Open the document and ask questions. Stream the response; allow stop/cancel and retain the partial answer.
3. Show source quotes only after server-side verification. Selecting a verified quote opens the document at its source passage and highlights it.
4. Reopen conversation history for the document. Replace or delete the document and its index explicitly.

## Data flow

```text
PDF/DOCX upload
  -> validate size/type and assign document_id + owner_id
  -> extract text and page/paragraph locations
  -> normalize and split into overlapping, location-aware chunks
  -> OpenAI embeddings -> Qdrant upsert with ownership and location payload
  -> persist document metadata and processing status

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

The repository includes a Vite + React + TypeScript frontend in `frontend/` and a FastAPI backend in `backend/`. The frontend proxies `/api` calls to the API during development. Registration, login, session restore/logout, and authenticated PDF/DOCX upload are implemented. Document extraction, Qdrant indexing, OpenAI calls, and question answering remain planned work.

### Start the API

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

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

Set `MONGODB_URI` and `JWT_SECRET_KEY` in `backend/.env`. Keep `.env` out of source control. Authentication route details and limitations are in [`backend/README.md`](backend/README.md). The assignment PDF is included in this folder as `hiring assignment.pdf`.

Do not commit `.env` files or API keys. The assignment PDF is included in this folder as `hiring assignment.pdf`.

## Requirements and delivery checklist

The evaluation asks for PDF/DOCX upload, extraction and status, a document library, streaming/cancellable chat, per-document history, verified quotes, large-document behavior, citation highlighting, multi-document questions, clause-level comparison, and one Part C challenge. Current implementation covers authentication, authenticated local upload, and the frontend shell. The implementation sequence and the chosen Part C option are described in `docs/implementation-plan.md`. Update this README as features are actually implemented; do not claim unfinished work as complete.

The submission also needs screenshots, a deployed link, and a 3–5 minute demo video. Add those only when they exist.

## Documentation

- [Architecture and isolation](docs/architecture.md)
- [Data model](docs/data-model.md)
- [Implementation plan](docs/implementation-plan.md)
