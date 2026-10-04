# Elcara

Elcara is a private contract workspace for reading, questioning, comparing, and revising PDF and DOCX agreements. Answers are grounded in extracted document text, and source quotes are checked against that text before the interface presents them as verified.

The application is built with a React and TypeScript frontend, a FastAPI backend, MongoDB, Qdrant, and the OpenAI SDK configured to call OpenRouter. Document extraction, indexing, retrieval, access checks, conversation storage, and quote verification are application responsibilities.

## What it does

- Sign in and work with documents associated with the signed-in account.
- Upload PDF and DOCX files, see processing progress, and open or remove documents.
- Ask questions in a streaming chat, stop an answer, and reopen saved conversations.
- Use broad-document and contents retrieval modes, with visible coverage information.
- Inspect verified citations and navigate to the source passage in the document viewer.
- Compare two document versions and ask questions across the pair.
- Run bounded agentic research with a live tool activity trace.
- Propose edits and download a DOCX containing native tracked changes.

## Product flow

```text
PDF or DOCX upload
  -> validate file type, signature, size, and configured page/text limits
  -> save original bytes in MongoDB GridFS and create document metadata
  -> background worker extracts and stores canonical text and source locations
  -> split text into overlapping chunks and create embeddings through OpenRouter
  -> index chunks in Qdrant with owner, document, version, and location metadata
  -> mark the document ready or return a visible processing error

Question
  -> authenticate and resolve the user's ready document
  -> choose focused, broad-document, or contents retrieval
  -> filter every Qdrant operation by owner, document, active state, and version
  -> stream model output and verify proposed citations against canonical text
  -> save conversation, answer state, citations, and coverage in MongoDB
```

## Technology

| Area | Current implementation |
| --- | --- |
| Web client | React 19, TypeScript, Vite, React Router DOM, Redux Toolkit, Tailwind CSS 3 |
| API | Python 3.11+ recommended, FastAPI, Pydantic |
| Account and document metadata | MongoDB through PyMongo's async client |
| Original files | MongoDB GridFS; optional remote storage fallback is supported by the storage service |
| Vector search | Qdrant, local or Qdrant Cloud |
| Model access | OpenAI Python SDK with OpenRouter base URL by default |
| PDF extraction/viewing | PyMuPDF on the server and PDF.js through React PDF in the browser |
| DOCX extraction | python-docx; tracked changes are written as WordprocessingML |

## Run locally

### Prerequisites

- Python 3.11 or newer.
- Node.js 20.19+ or 22.12+ for the current Vite release.
- MongoDB with a database user that can access the Elcara database.
- Qdrant, either local Docker or a Qdrant Cloud endpoint.
- An OpenRouter API key with access to the configured chat and embedding models.

### 1. Configure the backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

Set at least `MONGODB_URI`, `JWT_SECRET_KEY`, and `OPENROUTER_API_KEY` in `backend/.env`. Set `QDRANT_URL=http://localhost:6333` for local Qdrant, or configure `QDRANT_CLUSTER_ENDPOINT` and `QDRANT_API_KEY` for Qdrant Cloud.

### 2. Start local Qdrant

From the repository root:

```bash
docker compose up -d qdrant
```

Qdrant data is stored in the named Docker volume `qdrant_storage`.

### 3. Start the API

From `backend/`, with the virtual environment active:

```bash
uvicorn main:app --reload --port 8000
```

The API lifespan connects to MongoDB, creates required indexes, and starts the ingestion worker loop. The health endpoint is `http://localhost:8000/api/health`; interactive API documentation is available at `http://localhost:8000/docs`.

### 4. Start the frontend

In another terminal:

```bash
cd frontend
npm install
npm run start
```

Open `http://localhost:5173`. Vite proxies `/api` to the local backend. The frontend production API base can be set with `VITE_API_BASE_URL`.

## Configuration

Copy `backend/.env.example` to `backend/.env`. See [configuration and deployment](docs/deployment-and-operations.md) for every setting and deployment guidance. Never commit environment files, database connection strings, or API keys.

Important defaults include a 600-page PDF limit, 15 MiB maximum upload, three active documents per account, three million extracted characters, and 12 MiB extracted text. These are safety limits, not a promise that every document at the maximum will process within a fixed time.

## Account access status

The backend currently exposes sign-in, current-user, and sign-out routes, but does not expose public account registration. The `/register` frontend route redirects to `/login`. The UI also includes an automated demo sign-in path. Before making a public production release, replace demo-only access with an intentional account provisioning flow and remove any fixed credentials from application code.

## Documentation

Start at the [documentation index](docs/README.md).

- [Product overview](docs/product-overview.md)
- [Local setup](docs/getting-started.md)
- [Architecture and isolation](docs/architecture.md)
- [Data model](docs/data-model.md)
- [API reference](docs/api-reference.md)
- [Document processing and limits](docs/document-processing.md)
- [Chat, retrieval, and citations](docs/chat-and-citations.md)
- [Advanced features](docs/advanced-features.md)
- [Agentic research](docs/agentic-research.md)
- [Security and privacy](docs/security-and-privacy.md)
- [Deployment and operations](docs/deployment-and-operations.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Hiring assignment coverage](docs/assignment-task-list.md)
- [Roadmap and known limitations](docs/implementation-plan.md)
- [Broad-question retrieval issue](docs/issue-broad-book-questions.md)
- [Backend guide](backend/README.md)

## Hiring assignment delivery

The repository contains the app source and local setup instructions. The assignment also asks for screenshots, a working deployed link, a 3–5 minute demo video, and a short implementation note. Add links or images to this README when those deliverables are prepared; this document does not claim that they are present.
