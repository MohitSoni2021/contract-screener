# Security and privacy

## Ownership isolation

The backend derives the user ID from a verified bearer token. It does not accept a client-supplied owner ID as authority. MongoDB document lookups include both the requested document ID and authenticated owner ID. Qdrant searches, scrolling, and deletion use both owner and document filters, and retrieved point payloads are checked again before their text enters a model prompt.

Conversation and citation lookups are scoped to the authenticated user. Comparison checks ownership for each input document independently. Keep these checks when adding routes or retrieval modes; a Qdrant filter alone does not replace the MongoDB ownership check.

## Authentication

- Password hashes use Argon2 through `pwdlib`.
- Access tokens are signed JWTs with issuer, audience, issue time, expiration, and token ID claims.
- The default access-token lifetime is 60 minutes, configurable from 5 to 1,440 minutes.
- Sign-out records the token ID as revoked until expiration; a MongoDB TTL index cleans up expired entries.
- The browser currently stores its bearer token in `localStorage`. This exposes it to same-origin script execution; use a hardened content security policy and consider an HTTP-only secure cookie design before a public production launch.
- Public self-service registration, password reset, email verification, refresh tokens, and login rate limiting are not implemented.

The current UI includes a demo sign-in convenience flow, and the backend has demo-specific account behavior. Do not expose demo access as a production account policy. Remove fixed demo credentials from source and deploy an intentional account creation and access policy before public use.

## Source documents and model requests

Original files and canonical extracted text are stored in MongoDB (GridFS for file bytes). Relevant retrieved text is sent to the configured model provider for embeddings and answers. Treat contracts as sensitive data: use provider and database accounts with appropriate access controls, set retention policies, and inform users how document text is processed.

The current model client uses the OpenAI SDK protocol configured with OpenRouter by default. `OPENROUTER_API_KEY` and `QDRANT_API_KEY` must remain server-side. Do not expose them through `VITE_*` variables or frontend bundles.

## Deployment safeguards

- Use TLS for the frontend, API, MongoDB, and Qdrant connections in hosted environments.
- Use least-privilege database credentials and separate development, staging, and production databases/collections.
- Store secrets in the deployment platform's secret manager; never commit `.env` files.
- Set `CORS_ORIGINS` to the actual frontend origins for your environment.
- Keep Qdrant private behind its API key/network boundary. The local Docker ports are for development.
- Limit file size, page count, extracted characters, and document count. Revisit each limit only alongside memory, timeout, provider-cost, and queue-capacity measurements.
- Log request IDs, status transitions, and errors without logging API keys, bearer tokens, passwords, or full contract text.
- Define deletion and retention behavior for MongoDB source files, canonical text, Qdrant points, conversations, and backups.

## Citation safety

The backend verifies displayed source quotes against canonical extracted text and computes source offsets itself. This reduces fabricated citations, but it does not prove that a legal interpretation is correct, and extraction can omit or reorder content. Users should open the source and review material conclusions.
