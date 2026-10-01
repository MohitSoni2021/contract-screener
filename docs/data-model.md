# Data model

MongoDB is the source of truth for ownership and lifecycle in the current implementation. Qdrant is a derived search index and must never independently grant access.

## Tables

### `users` (multi-user mode)

- `id` (opaque primary key)
- `created_at`

The assignment's single-user mode may use a configured fixed owner instead of this table.

### `documents` (MongoDB collection)

- `id` (opaque primary key)
- `owner_id` (required; fixed owner in assignment mode)
- `original_filename` (display only; never use as a path)
- `stored_path`, `extension`, `canonical_text` (the extracted text used to verify indexed passages)
- `media_type` (`application/pdf` or DOCX MIME)
- `content_hash`
- `status` (`queued`, `extracting`, `chunking`, `embedding`, `indexing`, `ready`, `failed`, `deleted`)
- `stage`, `progress`, `indexed_chunks`, `error`
- `failure_code` / `failure_message`
- `active` (boolean)
- `index_version`, `embedding_model`, `embedding_dimensions`
- `page_count`, `chunk_count`
- `created_at`, `updated_at`, `deleted_at`

Enforce at most one active document per owner. The current MongoDB implementation uses a unique partial index on `owner_id` where `active=true`.

### `document_chunks` (optional relational mirror)

- `id`, `document_id`, `owner_id`, `ordinal`
- `canonical_text` or secure text-store reference
- `normalized_text_hash`
- `page_start`, `page_end`, `char_start`, `char_end`
- `block_start`, `block_end` (paragraph/table block references for DOCX)
- `index_version`, `created_at`

The Qdrant payload should reference these stable IDs and carry only fields needed for filtered retrieval and source resolution. If full text is duplicated in Qdrant, define retention/deletion behavior for both copies.

### `conversations`

- `id`, `owner_id`, `document_id`
- `title` (optional), `created_at`, `updated_at`

### `messages`

- `id`, `conversation_id`, `document_id`, `owner_id`
- `role` (`user` or `assistant`)
- `content`
- `status` (`complete`, `partial`, `cancelled`, `failed`)
- `citations` (verified chunk ID, exact source text, and server-resolved locations)
- `created_at`

### `citations`

- `id`, `message_id`, `document_id`, `chunk_id`
- `quote_text` (canonical verified text)
- `verified` (only verified citations are shown as genuine quotes)
- `page_start`, `page_end`, `char_start`, `char_end`
- `block_start`, `block_end`

Store citations separately so quote verification status and navigation locations remain inspectable. Never use model-supplied location fields without server recomputation.

## Qdrant point

- Point ID: deterministic UUID from `(document_id, index_version, ordinal)` or generated UUID stored alongside the chunk.
- Vector: embedding for the chunk's normalized text.
- Payload: `owner_id`, `document_id`, `chunk_id`, `index_version`, `active`, `ordinal`, page and offset fields, and optionally chunk text.

Every query filter combines exact `owner_id`, exact `document_id`, and the current `index_version`. Every delete uses the document's verified owner and document ID. Reindex by writing a new index version, then atomically switching the document's active version and removing old points.
