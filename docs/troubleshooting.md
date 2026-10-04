# Troubleshooting

## Frontend cannot reach the API

- Confirm the backend is listening on port 8000 and `/api/health` responds.
- During local development, verify Vite's `/api` proxy points to the backend.
- For a hosted frontend, set `VITE_API_BASE_URL` to the deployed API origin and rebuild the static app.
- Confirm the browser origin is permitted by `CORS_ORIGINS` and inspect the browser network panel for preflight failures.

## Sign-in fails

- Confirm MongoDB is reachable and `MONGODB_URI` points to the intended database.
- The current product does not provide public self-service registration. Use an account provisioned through the intended development/demo process.
- Confirm `JWT_SECRET_KEY` is set. Changing it invalidates existing sessions.
- Check API logs for MongoDB index failures. Duplicate email records can block unique index creation.

## Upload is rejected

- Only PDF and DOCX are supported; the file extension and signature must match.
- Check `MAX_UPLOAD_BYTES`, `MAX_PDF_PAGES`, `MAX_DOCUMENTS_PER_USER`, and extracted-text limits.
- An image-only scanned PDF has no selectable text and requires OCR before upload to this version.
- DOCX files must be valid Office Open XML packages.

## Processing stays queued or fails

- Ensure the API lifespan completed startup; it starts the worker loop.
- Confirm MongoDB can create indexes and update the document lease/status.
- Confirm the source file is available in GridFS.
- Check OpenRouter key, selected models, quota, rate limits, and network access.
- Confirm Qdrant endpoint and key. A vector-dimension mismatch means the selected embedding model does not match the existing collection.
- Inspect the document's status endpoint and server logs for the stage and error details.

## Qdrant says it cannot reach the server

- For local setup, start the `qdrant` Compose service and use `http://localhost:6333`.
- If `QDRANT_CLUSTER_ENDPOINT` is set, it takes precedence over `QDRANT_URL`.
- For a private or cloud cluster, check endpoint, API key, DNS, firewall, TLS, and the configured timeout.
- A client warning about server-version compatibility can indicate that Qdrant's version endpoint is unavailable; check actual queries and health before treating it as an indexing failure.

## Answer says evidence was insufficient

- Confirm the document is `ready` and has indexed passages.
- Ask a narrower question using wording from the contract, then open the returned citations.
- For an overview, request key points or an overview; broad mode uses distributed document evidence and displays coverage.
- For a table of contents, ask for the contents explicitly. The outline extractor uses heuristics and can fail on unusual formatting.
- A scanned page, extraction gap, or unsupported language/layout may be missing from canonical text. Compare the answer with the original file.

## Citation opens the wrong-looking location

- PDF rendering text can be split or ordered differently from extraction, and repeated wording can be ambiguous. Confirm the page number and exact quote.
- DOCX page layout can change across software and fonts; this app navigates with block and text anchors rather than fixed page numbers.
- If the viewer cannot render the source, use the displayed verified quote and open or download the original file.

## Research does not finish or lacks a clause

- Research is bounded by `RESEARCH_MAX_ROUNDS` and `RESEARCH_MAX_TOKENS`.
- Confirm the selected model supports OpenAI-compatible function/tool calling.
- Review the live tool trace; malformed calls and repeated calls are bounded, and extraction/heading heuristics may miss sections.
- A search miss is not proof that a provision is absent.

## Comparison or redline fails

- Both comparison documents must be distinct, ready, and owned by the current account.
- If a comparison appears incorrect, inspect the matched source text in both original documents; section alignment and impact labels are heuristic/model-assisted.
- Redline target text may not match if it is repeated, split across runs, or differs after extraction. Review the downloaded DOCX in Word or LibreOffice.
- A PDF-derived redline is a newly generated DOCX and cannot preserve the original PDF design.
