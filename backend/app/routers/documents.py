from datetime import datetime, timezone
import logging
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from pymongo.errors import DuplicateKeyError

from app.config import BACKEND_DIR, max_upload_bytes
from app.dependencies import AuthenticatedUser, get_current_user, get_database
from app.services.qdrant_repository import create_qdrant_client, delete_document_vectors
from app.services.comparison import compare_documents
from app.services.extraction import extract_document

router = APIRouter(prefix="/api/documents", tags=["documents"])
logger = logging.getLogger(__name__)
UPLOAD_DIR = BACKEND_DIR / "data" / "uploads"
ALLOWED_EXTENSIONS = {".pdf", ".docx"}
IN_PROGRESS_STATUSES = {"extracting", "chunking", "embedding", "indexing"}


class ComparisonRequest(BaseModel):
    old_document_id: str
    new_document_id: str


def validate_upload_content(extension: str, size: int, header: bytes, limit: int) -> None:
    """Validate upload bytes after streaming them to disk.

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
        "created_at": document["created_at"].isoformat(),
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
    user_upload_dir = UPLOAD_DIR / user.id
    saved_path = user_upload_dir / f"{document_id}{extension}"
    user_upload_dir.mkdir(parents=True, exist_ok=True)
    size = 0
    upload_limit = max_upload_bytes()
    header = b""
    try:
        with saved_path.open("wb") as destination:
            while chunk := await file.read(1024 * 1024):
                if not header:
                    header = chunk[:1024]
                size += len(chunk)
                if size > upload_limit:
                    limit_mb = upload_limit // (1024 * 1024)
                    raise HTTPException(status_code=413, detail=f"File is larger than the configured {limit_mb} MB upload limit.")
                destination.write(chunk)
    except HTTPException:
        saved_path.unlink(missing_ok=True)
        raise
    finally:
        await file.close()

    try:
        validate_upload_content(extension, size, header, upload_limit)
    except HTTPException:
        saved_path.unlink(missing_ok=True)
        raise

    now = datetime.now(timezone.utc)
    record = {
        "document_id": document_id,
        "owner_id": user.id,
        "filename": original_name,
        "extension": extension,
        "stored_path": str(saved_path),
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
        saved_path.unlink(missing_ok=True)
        raise HTTPException(status_code=409, detail="This document could not be added. Please try again.") from None
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
    try:
        old_extracted = extract_document(Path(old_document["stored_path"]), old_document["extension"])
        new_extracted = extract_document(Path(new_document["stored_path"]), new_document["extension"])
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
) -> FileResponse:
    document = await _owned_document(database, user.id, document_id)
    if document.get("status") != "ready":
        raise HTTPException(status_code=409, detail="The document is not ready to view.")
    path = Path(document["stored_path"])
    if not path.is_file():
        raise HTTPException(status_code=404, detail="The original document file is unavailable.")
    media_type = "application/pdf" if document["extension"] == ".pdf" else (
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    )
    return FileResponse(path, media_type=media_type, filename=document["filename"])


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
            # The document is marked inactive below, so stale vectors remain unreachable
            # through the mandatory active/owner/document Qdrant filter.
            logger.exception("Could not remove document vectors", extra={"document_id": document_id})
    finally:
        await qdrant.close()
    Path(document["stored_path"]).unlink(missing_ok=True)
    await database.documents.update_one(
        {"document_id": document_id, "owner_id": user.id, "active": True},
        {"$set": {"active": False, "status": "deleted", "updated_at": datetime.now(timezone.utc)}},
    )
