# Elcara API

FastAPI backend with MongoDB-backed account registration, login, current-user lookup, JWT logout/revocation, and authenticated PDF/DOCX upload.

## Configure and start

```bash
cd backend
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
cp .env.example .env  # Fill in MONGODB_URI and a long random JWT_SECRET_KEY.
uvicorn main:app --reload --port 8000
```

The backend reads `backend/.env`; that file is ignored by Git. On startup, the API checks MongoDB connectivity and creates a unique email index plus a TTL index for revoked tokens. API docs are at `http://127.0.0.1:8000/docs`.

## Authentication routes

- `POST /api/auth/register` — `{ "name", "email", "password" }`; stores a normalized email and Argon2 password hash, then returns a bearer token and public user.
- `POST /api/auth/login` — `{ "email", "password" }`; returns the same session shape.
- `GET /api/auth/me` — requires `Authorization: Bearer <token>`.
- `POST /api/auth/logout` — revokes the current token until it expires.

Tokens expire after 60 minutes by default. Adjust `JWT_ACCESS_TOKEN_MINUTES` within the supported 5–1440 minute range. Upload requests also require a bearer token and files are saved under a per-user directory.

## Current limitations

There is no email verification, password reset, rate limiting, refresh-token flow, or production cookie-based session yet. The frontend keeps the access token in localStorage for this starter. Uploaded-file records, document parsing, Qdrant indexing, OpenAI calls, and chat are not implemented. Use a least-privilege MongoDB database user and restrict network access in MongoDB Atlas before deployment.
