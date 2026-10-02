from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import asyncio
import logging

from openai import AsyncOpenAI

from app.config import max_extracted_characters, max_extracted_text_bytes, max_pdf_pages
from app.services.ai_client import create_ai_client, embedding_model
from app.services.chunking import chunk_document
from app.services.extraction import extract_document, pdf_page_count
from app.services.qdrant_repository import (
    collection_name,
    create_qdrant_client,
    delete_document_vectors,
    ensure_collection,
    make_point,
)
from app.services.structure import extract_structure

EMBEDDING_BATCH_SIZE = 64
logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _set_status(database: Any, document_id: str, **fields: Any) -> None:
    update = {"$set": {**fields, "updated_at": _now()}}
    if fields.get("status") in {"ready", "failed"}:
        update["$unset"] = {"worker_id": "", "lease_expires_at": ""}
    await database.documents.update_one(
        {"document_id": document_id}, update
    )


async def ingest_document(database: Any, document: dict[str, Any], file_path: Path) -> None:
    document_id = document["document_id"]
    qdrant = create_qdrant_client()
    embedding_client: AsyncOpenAI | None = None
    try:
        # Keep the OpenAI SDK interface so the provider can be changed independently later.
        embedding_client = create_ai_client()
        await _set_status(database, document_id, status="extracting", stage="Extracting text", progress=8)
        if document["extension"] == ".pdf":
            page_count = await asyncio.to_thread(pdf_page_count, file_path)
            page_limit = max_pdf_pages()
            if page_count > page_limit:
                raise ValueError(f"This PDF has {page_count} pages. The limit is {page_limit} pages.")
        extracted = await asyncio.to_thread(
            extract_document,
            file_path,
            document["extension"],
            max_characters=max_extracted_characters(),
            max_bytes=max_extracted_text_bytes(),
        )
        if not extracted.text.strip():
            raise ValueError("No selectable text was found. Scanned PDFs need OCR before they can be processed.")

        await _set_status(
            database, document_id, status="chunking", stage="Preparing document sections", progress=22,
            page_count=extracted.page_count, canonical_text=extracted.text,
            structure=extract_structure(extracted.text, extracted.blocks),
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
        logger.exception("Document ingestion failed", extra={"document_id": document_id})
        try:
            await delete_document_vectors(
                qdrant, owner_id=document["owner_id"], document_id=document_id
            )
        except Exception:
            pass
        await _set_status(
            database, document_id, status="failed", stage="Processing failed", progress=0,
            error=(
                str(exc)
                if isinstance(exc, ValueError)
                else f"{type(exc).__name__}: {exc}"
                if str(exc)
                else f"{type(exc).__name__}: ingestion service error"
            ),
        )
    finally:
        if embedding_client is not None:
            await embedding_client.close()
        await qdrant.close()
