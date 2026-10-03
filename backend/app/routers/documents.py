import asyncio
from datetime import datetime, timezone
import logging
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile, status
from pydantic import BaseModel
from pymongo.errors import DuplicateKeyError

from app.config import max_upload_bytes
from app.dependencies import AuthenticatedUser, get_current_user, get_database
from app.services.qdrant_repository import create_qdrant_client, delete_document_vectors
from app.services.comparison import compare_documents
from app.services.extraction import extract_document
from app.services.storage import (
    delete_document_file,
    get_document_bytes,
    store_file_in_database,
)
from app.worker import claim_and_process_document

router = APIRouter(prefix="/api/documents", tags=["documents"])
logger = logging.getLogger(__name__)
ALLOWED_EXTENSIONS = {".pdf", ".docx"}
IN_PROGRESS_STATUSES = {"extracting", "chunking", "embedding", "indexing"}


class ComparisonRequest(BaseModel):
    old_document_id: str
    new_document_id: str


def validate_upload_content(extension: str, size: int, header: bytes, limit: int) -> None:
    """Validate upload bytes before processing or saving.

    Keeping this policy separate from the request handler makes malformed-file
    and size-limit behavior easy to test and keeps the handler focused on I/O.
    """
    if size == 0:
        raise HTTPException(status_code=400, detail="The selected file is empty.")
    if size > limit:
        limit_mb = limit // (1024 * 1024)
        raise HTTPException(status_code=413, detail=f"File is larger than the configured {limit_mb} MB upload limit.")
    if extension == ".pdf" and b"%PDF-" not in header:
        raise HTTPException(status_code=415, detail="This file does not appear to be a valid PDF.")
    if extension == ".docx" and not header.startswith(b"PK"):
        raise HTTPException(status_code=415, detail="This file does not appear to be a valid DOCX document.")


def _public_document(document: dict[str, Any] | None) -> dict[str, Any] | None:
    if document is None:
        return None
    return {
        "document_id": document["document_id"],
        "filename": document["filename"],
        "status": document["status"],
        "stage": document.get("stage", ""),
        "progress": document.get("progress", 0),
        "page_count": document.get("page_count"),
        "chunk_count": document.get("chunk_count"),
        "indexed_chunks": document.get("indexed_chunks", 0),
        "error": document.get("error"),
        "created_at": document["created_at"].isoformat() if hasattr(document["created_at"], "isoformat") else str(document["created_at"]),
    }


async def _owned_document(database: Any, user_id: str, document_id: str) -> dict[str, Any]:
    document = await database.documents.find_one(
        {"document_id": document_id, "owner_id": user_id, "active": True},
        {"_id": 0},
    )
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    return document


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def upload_document(
    file: UploadFile = File(...),
    user: AuthenticatedUser = Depends(get_current_user),
    database: Any = Depends(get_database),
) -> dict[str, Any]:
    original_name = Path(file.filename or "document").name
    extension = Path(original_name).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Only PDF and DOCX files are supported.")

    document_id = str(uuid4())
    upload_limit = max_upload_bytes()

    try:
        file_bytes = await file.read()
    finally:
        await file.close()

    size = len(file_bytes)
    header = file_bytes[:1024]
    validate_upload_content(extension, size, header, upload_limit)

    content_type = "application/pdf" if extension == ".pdf" else (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )

    # Store the file directly in the database (MongoDB GridFS)
    gridfs_id = await store_file_in_database(
        database,
        filename=f"{document_id}{extension}",
        content=file_bytes,
        metadata={
            "document_id": document_id,
            "owner_id": user.id,
            "filename": original_name,
            "content_type": content_type,
        },
    )

    now = datetime.now(timezone.utc)
    record = {
        "document_id": document_id,
        "owner_id": user.id,
        "filename": original_name,
        "extension": extension,
        "gridfs_id": gridfs_id,
        "file_size": size,
        "status": "queued",
        "stage": "Upload complete. Preparing document…",
        "progress": 2,
        "indexed_chunks": 0,
        "index_version": 1,
        "active": True,
        "created_at": now,
        "updated_at": now,
    }
    try:
        await database.documents.insert_one(record)
    except DuplicateKeyError:
        await delete_document_file(database, record)
        raise HTTPException(status_code=409, detail="This document could not be added. Please try again.") from None

    # Kick off background document ingestion immediately
    asyncio.create_task(
        claim_and_process_document(
            database,
            worker_id=f"upload:{uuid4()}",
            document_id=document_id,
            file_bytes=file_bytes,
        )
    )

    return _public_document(record) or {}


@router.get("")
async def list_documents(
    user: AuthenticatedUser = Depends(get_current_user),
    database: Any = Depends(get_database),
) -> dict[str, Any]:
    cursor = database.documents.find(
        {"owner_id": user.id, "active": True}, {"_id": 0}
    ).sort("created_at", -1)
    documents = await cursor.to_list(length=100)
    return {"documents": [_public_document(document) for document in documents]}


@router.get("/current")
async def current_document(
    user: AuthenticatedUser = Depends(get_current_user),
    database: Any = Depends(get_database),
) -> dict[str, Any]:
    document = await database.documents.find_one(
        {"owner_id": user.id, "active": True}, {"_id": 0}, sort=[("created_at", -1)]
    )
    return {"document": _public_document(document)}


@router.post("/compare")
async def compare_document_versions(
    request: ComparisonRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    database: Any = Depends(get_database),
) -> dict[str, Any]:
    if request.old_document_id == request.new_document_id:
        raise HTTPException(status_code=400, detail="Choose two different document versions.")
    old_document = await _owned_document(database, user.id, request.old_document_id)
    new_document = await _owned_document(database, user.id, request.new_document_id)
    if old_document.get("status") != "ready" or new_document.get("status") != "ready":
        raise HTTPException(status_code=409, detail="Both document versions must finish processing before comparison.")
    old_bytes = await get_document_bytes(database, old_document)
    new_bytes = await get_document_bytes(database, new_document)
    if not old_bytes or not new_bytes:
        raise HTTPException(status_code=404, detail="One of the document versions is unavailable.")
    try:
        old_extracted = extract_document(old_bytes, old_document["extension"])
        new_extracted = extract_document(new_bytes, new_document["extension"])
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=f"Could not extract a document version: {exc}") from exc
    changes = compare_documents(old_extracted, new_extracted, request.old_document_id, request.new_document_id)
    return {
        "old_document": _public_document(old_document),
        "new_document": _public_document(new_document),
        "changes": changes,
        "summary": {
            "total": len(changes),
            "substantive": sum(change["significance"] == "substantive" for change in changes),
            "wording": sum(change["significance"] == "wording" for change in changes),
            "formatting": sum(change["significance"] == "formatting" for change in changes),
        },
    }


@router.get("/{document_id}")
async def get_document_status(
    document_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
    database: Any = Depends(get_database),
) -> dict[str, Any]:
    document = await _owned_document(database, user.id, document_id)
    return _public_document(document) or {}


@router.get("/{document_id}/file")
async def get_document_file(
    document_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
    database: Any = Depends(get_database),
) -> Response:
    document = await _owned_document(database, user.id, document_id)
    if document.get("status") != "ready":
        raise HTTPException(status_code=409, detail="The document is not ready to view.")
    file_bytes = await get_document_bytes(database, document)
    if file_bytes is None:
        raise HTTPException(status_code=404, detail="The original document file is unavailable.")
    media_type = "application/pdf" if document["extension"] == ".pdf" else (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    return Response(
        content=file_bytes,
        media_type=media_type,
        headers={"Content-Disposition": f'inline; filename="{document["filename"]}"'},
    )


@router.get("/{document_id}/content")
async def get_document_content(
    document_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
    database: Any = Depends(get_database),
) -> dict[str, Any]:
    document = await _owned_document(database, user.id, document_id)
    canonical = document.get("canonical_text")
    if not canonical:
        from app.routers.chat import _canonical_text
        canonical = await _canonical_text(database, document)
    return {
        "id": document["document_id"],
        "document_id": document["document_id"],
        "name": document["filename"],
        "filename": document["filename"],
        "fullText": canonical,
        "pageCount": document.get("page_count"),
        "status": document.get("status"),
    }


@router.post("/{document_id}/process")
async def process_document_endpoint(
    document_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
    database: Any = Depends(get_database),
) -> dict[str, Any]:
    document = await _owned_document(database, user.id, document_id)
    file_bytes = await get_document_bytes(database, document)
    if not file_bytes:
        raise HTTPException(status_code=404, detail="Document file not available.")
    asyncio.create_task(
        claim_and_process_document(
            database,
            worker_id=f"reprocess:{uuid4()}",
            document_id=document_id,
            file_bytes=file_bytes,
        )
    )
    return {"status": "processing", "document_id": document_id}


@router.get("/{document_id}/chats")
async def get_document_chats(
    document_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
    database: Any = Depends(get_database),
) -> dict[str, Any]:
    await _owned_ready_document(database, user.id, document_id)
    conversations = await database.conversations.find(
        {"owner_id": user.id, "document_id": document_id},
        {"_id": 0, "conversation_id": 1, "title": 1, "created_at": 1, "updated_at": 1},
    ).sort("updated_at", -1).limit(50).to_list(length=50)
    return {
        "chats": [
            {
                "id": item["conversation_id"],
                "conversation_id": item["conversation_id"],
                "documentId": document_id,
                "title": item.get("title") or "Chat",
                "createdAt": item["created_at"].isoformat() if hasattr(item["created_at"], "isoformat") else str(item["created_at"]),
            }
            for item in conversations
        ]
    }


@router.delete("/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    document_id: str,
    user: AuthenticatedUser = Depends(get_current_user),
    database: Any = Depends(get_database),
) -> None:
    document = await _owned_document(database, user.id, document_id)
    if document["status"] in IN_PROGRESS_STATUSES:
        raise HTTPException(status_code=409, detail="Wait for document processing to finish before removing it.")

    qdrant = create_qdrant_client()
    try:
        try:
            await delete_document_vectors(qdrant, owner_id=user.id, document_id=document_id)
        except Exception:
            logger.exception("Could not remove document vectors", extra={"document_id": document_id})
    finally:
        await qdrant.close()

    await delete_document_file(database, document)
    await database.documents.update_one(
        {"document_id": document_id, "owner_id": user.id, "active": True},
        {"$set": {"active": False, "status": "deleted", "updated_at": datetime.now(timezone.utc)}},
    )


