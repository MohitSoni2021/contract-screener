from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from openai import AsyncOpenAI

from app.services.ai_client import create_ai_client, embedding_model
from app.services.chunking import chunk_document
from app.services.extraction import extract_document
from app.services.qdrant_repository import (
    collection_name,
    create_qdrant_client,
    delete_document_vectors,
    ensure_collection,
    make_point,
)

EMBEDDING_BATCH_SIZE = 64
MAX_DOCUMENT_PAGES = 300
MAX_EXTRACTED_CHARACTERS = 3_000_000


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _set_status(database: Any, document_id: str, **fields: Any) -> None:
    await database.documents.update_one(
        {"document_id": document_id}, {"$set": {**fields, "updated_at": _now()}}
    )


async def ingest_document(database: Any, document: dict[str, Any], file_path: Path) -> None:
    document_id = document["document_id"]
    qdrant = create_qdrant_client()
    embedding_client: AsyncOpenAI | None = None
    try:
        # Keep the OpenAI SDK interface so the provider can be changed independently later.
        embedding_client = create_ai_client()
        await _set_status(database, document_id, status="extracting", stage="Extracting text", progress=8)
        extracted = extract_document(file_path, document["extension"])
        if extracted.page_count and extracted.page_count > MAX_DOCUMENT_PAGES:
            raise ValueError(f"This PDF has {extracted.page_count} pages. The limit is {MAX_DOCUMENT_PAGES} pages.")
        if not extracted.text.strip():
            raise ValueError("No selectable text was found. Scanned PDFs need OCR before they can be processed.")
        if len(extracted.text) > MAX_EXTRACTED_CHARACTERS:
            raise ValueError("This document contains more text than the current 3 million character limit.")

        await _set_status(
            database, document_id, status="chunking", stage="Preparing document sections", progress=22,
            page_count=extracted.page_count, canonical_text=extracted.text,
        )
        chunks = chunk_document(extracted.text, extracted.blocks)
        if not chunks:
            raise ValueError("No readable text sections could be created from this document.")
        model = embedding_model()
        await _set_status(
            database, document_id, status="embedding", stage="Creating searchable sections", progress=30,
            chunk_count=len(chunks),
        )

        for batch_start in range(0, len(chunks), EMBEDDING_BATCH_SIZE):
            batch = chunks[batch_start : batch_start + EMBEDDING_BATCH_SIZE]
            response = await embedding_client.embeddings.create(
                model=model,
                input=[chunk.text for chunk in batch],
            )
            vectors = [item.embedding for item in sorted(response.data, key=lambda item: item.index)]
            if not vectors or len(vectors) != len(batch):
                raise RuntimeError("The embedding service returned an incomplete batch.")
            await ensure_collection(qdrant, len(vectors[0]))
            points = [
                make_point(
                    owner_id=document["owner_id"], document_id=document_id,
                    index_version=document.get("index_version", 1), chunk=chunk, vector=vector,
                )
                for chunk, vector in zip(batch, vectors, strict=True)
            ]
            await qdrant.upsert(collection_name=collection_name(), points=points, wait=True)
            progress = 30 + int(60 * min(batch_start + len(batch), len(chunks)) / len(chunks))
            await _set_status(
                database, document_id, status="indexing", stage="Saving sections to your private index",
                progress=min(progress, 94), indexed_chunks=batch_start + len(batch),
            )

        await _set_status(
            database, document_id, status="ready", stage="Ready to ask questions", progress=100,
            indexed_chunks=len(chunks), completed_at=_now(),
        )
    except Exception as exc:
        try:
            await delete_document_vectors(
                qdrant, owner_id=document["owner_id"], document_id=document_id
            )
        except Exception:
            pass
        await _set_status(
            database, document_id, status="failed", stage="Processing failed", progress=0,
            error=str(exc) if isinstance(exc, ValueError) else "We could not process this document. Check the service settings and try again.",
        )
    finally:
        if embedding_client is not None:
            await embedding_client.close()
        await qdrant.close()
