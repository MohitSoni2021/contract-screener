# Data model

The backend uses MongoDB collections for application records and MongoDB GridFS for original file bytes. Qdrant contains derived vector points. IDs shown below are representative; the implementation uses opaque IDs and BSON ObjectIds where appropriate.

## MongoDB collections

### `users`

Stores account identity and an Argon2 password hash. Email is normalized to lowercase and indexed uniquely. Public user responses contain the account ID, name, and email, never the password hash.

### `documents`

One record per uploaded source file. Important fields include:

| Field | Meaning |
| --- | --- |
| `document_id` | Public opaque ID used by API routes |
| `owner_id` | Server-resolved user ID |
| `filename`, `extension`, `file_size` | Upload metadata |
| `gridfs_id` | Reference to original bytes in GridFS |
| `status`, `stage`, `progress`, `error` | Processing state surfaced to the client |
| `active` | Whether this record can be selected |
| `index_version` | Version used to scope Qdrant points |
| `canonical_text` | Extracted text used for retrieval and citation verification |
| `structure` | Extracted heading and contents metadata |
| `page_count`, `chunk_count`, `indexed_chunks` | Processing metrics |
| `worker_id`, `lease_expires_at` | Worker ownership and recovery state |
| `created_at`, `updated_at`, `completed_at` | Lifecycle timestamps |

The configured default allows three active documents per user. The index on owner, active state, and creation date supports the document library. A unique compound index prevents a document ID from being assigned to multiple owners. Deletion removes original bytes and attempts to remove Qdrant points, then marks the record inactive with `deleted` status.

### `conversations`

Stores `conversation_id`, `owner_id`, `document_id`, title, and timestamps. The conversation belongs to both one user and one document. Listing is limited to the authenticated user's selected document.

### `messages`

Stores user and assistant messages with `conversation_id`, `document_id`, `owner_id`, role, content, status, timestamps, and verified citations. Assistant messages can also store a `coverage` object describing retrieval mode and evidence coverage. Cancelled and partial answers remain available in conversation history.

### `revoked_tokens`

Stores token IDs revoked at sign-out and their expiration time. MongoDB's TTL index removes expired entries.

### GridFS bucket `document_files`

Stores the original PDF or DOCX bytes. The file metadata includes document and owner IDs, the original filename, and content type.

## Qdrant collection

The collection name defaults to `document_chunks`. Each point represents one indexed text chunk:

```json
{
  "id": "stable-vector-point-id",
  "vector": [0.01, -0.02],
  "payload": {
    "owner_id": "user-id",
    "document_id": "document-id",
    "chunk_id": "stable-chunk-id",
    "index_version": 1,
    "active": true,
    "ordinal": 12,
    "text": "Extracted passage text",
    "char_start": 12000,
    "char_end": 15600,
    "page_start": 9,
    "page_end": 11,
    "block_start": 30,
    "block_end": 38
  }
}
```

Qdrant payload indexes are created for `owner_id`, `document_id`, `active`, and `index_version`. The backend must include owner and document filters in every vector operation. Index version separates points produced from different indexing runs.

## Source locations

- PDF blocks carry a page number and block number. Chunks retain character offsets into canonical text and the min/max page and block anchors of overlapping blocks.
- DOCX blocks carry paragraph/table order. DOCX has no stable page number in the extracted representation, so its citations use block and character offsets.
- The AI does not choose citation offsets. The server maps and verifies candidate quotes against canonical text.

## Derived versus canonical data

The original file and canonical extracted text are the source of truth. Qdrant points and outline metadata are derived and may be regenerated. A vector payload is accepted as evidence only after its text and character range agree with the canonical document text.
