# Getting started

This guide starts the application locally. It assumes Python, Node.js, Docker, MongoDB, and an OpenRouter key are available.

## 1. Prepare environment files

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
```

Set the required values in `backend/.env`:

- `MONGODB_URI` — connection string for a MongoDB database.
- `JWT_SECRET_KEY` — long random signing secret; use a different value for every environment.
- `OPENROUTER_API_KEY` — key used by the OpenAI-compatible SDK client.
- `QDRANT_URL` — local Qdrant URL if `QDRANT_CLUSTER_ENDPOINT` is unset.

The optional frontend `.env` file may set `VITE_API_BASE_URL`. During local Vite development, the default proxy sends `/api` to `http://localhost:8000`.

## 2. Start Qdrant

From the project root:

```bash
docker compose up -d qdrant
```

The API uses `http://localhost:6333` by default when no cloud endpoint is configured. Verify the container is healthy through its local health endpoint or Docker status.

## 3. Start the API

From `backend/` with the virtual environment active:

```bash
uvicorn main:app --reload --port 8000
```

The API startup checks MongoDB, creates its indexes, and starts the ingestion worker loop. Use `http://localhost:8000/api/health` for the health response and `http://localhost:8000/docs` to inspect the generated API schema.

## 4. Start the frontend

In a second terminal:

```bash
cd frontend
npm install
npm run start
```

Open `http://localhost:5173`. The frontend is a Vite single-page application; route fallbacks are configured for direct navigation to app pages.

## 5. Verify a document workflow

1. Sign in using an account already present in MongoDB or the configured demo access flow.
2. Upload a text-based PDF or DOCX within the configured limits.
3. Watch the status until it reaches `ready`. A failed status includes an error message.
4. Open the document chat and ask a narrow question with a traceable answer.
5. Select a verified citation to inspect its source location.

The repository currently does not include public self-service registration. See [security and privacy](security-and-privacy.md) before deploying the demo login flow to a public environment.

## Useful commands

```bash
# Backend test suite (configure required local services as needed)
cd backend && pytest

# Frontend production build
cd frontend && npm run build

# Stop local Qdrant
docker compose down
```

Stopping Qdrant does not remove its named volume. To delete indexed local vectors and Qdrant data permanently, remove the volume explicitly after confirming that you do not need it.
