# API reference

All application routes require `Authorization: Bearer <access_token>` unless marked public. JSON request field names follow the implementation; inspect `/docs` on the running API for complete schemas, error models, and the exact checked-out contract.

## Authentication

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/login` | Verify credentials and return a bearer session |
| `GET` | `/api/auth/me` | Return the authenticated user's public profile |
| `POST` | `/api/auth/logout` | Revoke the current token until expiry |

There is no public registration endpoint at present.

## Documents

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/documents` | Multipart upload using the `file` field; returns `202` and processing status |
| `GET` | `/api/documents` | List active documents belonging to the caller |
| `GET` | `/api/documents/current` | Return the caller's most recently created active document |
| `GET` | `/api/documents/{document_id}` | Read status and processing progress |
| `GET` | `/api/documents/{document_id}/file` | Return the original file; `format=pdf` requests DOCX conversion for preview |
| `GET` | `/api/documents/{document_id}/content` | Return extracted text content for the caller's document |
| `POST` | `/api/documents/{document_id}/process` | Request processing through the document workflow |
| `GET` | `/api/documents/{document_id}/chats` | List chats associated with a document |
| `DELETE` | `/api/documents/{document_id}` | Remove the user's document and its associated resources |
| `POST` | `/api/documents/compare` | Compare two versions using `old_document_id` and `new_document_id` |

Document statuses include `queued`, `extracting`, `chunking`, `embedding`, `indexing`, `ready`, and `failed`. The status response includes `stage`, `progress`, `indexed_chunks`, optional page/chunk counts, and an error when processing fails.

## Chat and history

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/chat/stream` | Start or continue a document conversation using SSE |
| `GET` | `/api/documents/{document_id}/conversations` | List the caller's conversations for a ready document |
| `GET` | `/api/conversations/{conversation_id}` | Read a conversation and up to 500 messages |
| `DELETE` | `/api/conversations/{conversation_id}` | Delete the conversation and messages |
| `GET` | `/api/chats/{chat_id}` | Compatibility route to read a chat |
| `POST` | `/api/chats/{chat_id}/messages` | Continue a chat and stream the answer using SSE |
| `POST` | `/api/chats/{chat_id}/cancel` | Mark an active answer cancelled |
| `DELETE` | `/api/chats/{chat_id}` | Delete a chat and its messages |
| `GET` | `/api/citations/{citation_id}` | Resolve citation data from the caller's message history |

The primary chat request accepts `document_id`, `question`, optional `conversation_id`, and optional `mode`. The client should parse named SSE events rather than assume each network chunk is a complete event. Events include `conversation`, `status`, `coverage`, `token`, `citations`, `done`, and `error`.

## Research

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/research` | Run a document research request and return a result |
| `POST` | `/api/research/stream` | Run research with streaming progress events |
| `POST` | `/api/agent/research` | Agent research endpoint accepting one to five `documentIds` |

The `/api/research` routes use `document_id` and `question`. `/api/agent/research` uses `documentIds` (one to five IDs) and `question`. Streaming research events can include `status`, `tool_start`, `tool_result`, `answer_delta`, `final`, and `error`.

## Comparison

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/compare` | Create a comparison report for `leftDocumentId` and `rightDocumentId` |
| `POST` | `/api/compare/chat` | Ask a question across those two documents using `question` |

Both documents must be distinct, owned by the caller, and ready. Returned quotes are verified against their corresponding source document.

## Redline

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/redline` | Propose changes using `documentId` and an `instruction` |
| `POST` | `/api/redline/apply` | Generate a DOCX with tracked changes using `documentId` and an `edits` array |

The apply route returns a DOCX attachment. It accepts between 1 and 20 edits. A redline is a proposal and requires human review.

## Health and OpenAPI

| Method | Route | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/health` | No | Lightweight service health response |
| `GET` | `/docs` | No | Interactive OpenAPI documentation |
| `GET` | `/openapi.json` | No | OpenAPI schema |
