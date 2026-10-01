from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from fastapi.responses import FileResponse
from pymongo.errors import DuplicateKeyError

from app.config import BACKEND_DIR
from app.dependencies import AuthenticatedUser, get_current_user, get_database
from app.services.ingestion import ingest_document
from app.services.qdrant_repository import create_qdrant_client, delete_document_vectors

router = APIRouter(prefix="/api/documents", tags=["documents"])
UPLOAD_DIR = BACKEND_DIR / "data" / "uploads"
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
ALLOWED_EXTENSIONS = {".pdf", ".docx"}
IN_PROGRESS_STATUSES = {"queued", "extracting", "chunking", "embedding", "indexing"}


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
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user: AuthenticatedUser = Depends(get_current_user),
    database: Any = Depends(get_database),
) -> dict[str, Any]:
    original_name = Path(file.filename or "document").name
    extension = Path(original_name).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Only PDF and DOCX files are supported.")
    existing = await database.documents.find_one(
        {"owner_id": user.id, "active": True}, {"_id": 0, "status": 1}
    )
    if existing:
        message = "Remove the current document before uploading a replacement."
        if existing.get("status") in IN_PROGRESS_STATUSES:
            message = "Your document is still processing. Wait for it to finish before replacing it."
        raise HTTPException(status_code=409, detail=message)

    document_id = str(uuid4())
    user_upload_dir = UPLOAD_DIR / user.id
    saved_path = user_upload_dir / f"{document_id}{extension}"
    user_upload_dir.mkdir(parents=True, exist_ok=True)
    size = 0
    header = b""
    try:
        with saved_path.open("wb") as destination:
            while chunk := await file.read(1024 * 1024):
                if not header:
                    header = chunk[:1024]
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(status_code=413, detail="File is larger than the 25 MB limit.")
                destination.write(chunk)
    except HTTPException:
        saved_path.unlink(missing_ok=True)
        raise
    finally:
        await file.close()

    if size == 0:
        saved_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="The selected file is empty.")
    if extension == ".pdf" and b"%PDF-" not in header:
        saved_path.unlink(missing_ok=True)
        raise HTTPException(status_code=415, detail="This file does not appear to be a valid PDF.")
    if extension == ".docx" and not header.startswith(b"PK"):
        saved_path.unlink(missing_ok=True)
        raise HTTPException(status_code=415, detail="This file does not appear to be a valid DOCX document.")

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
        raise HTTPException(status_code=409, detail="Remove the current document before uploading a replacement.") from None
    background_tasks.add_task(ingest_document, database, record, saved_path)
    return _public_document(record) or {}


@router.get("/current")
async def current_document(
    user: AuthenticatedUser = Depends(get_current_user),
    database: Any = Depends(get_database),
) -> dict[str, Any]:
    document = await database.documents.find_one(
        {"owner_id": user.id, "active": True}, {"_id": 0}, sort=[("created_at", -1)]
    )
    return {"document": _public_document(document)}


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
        await delete_document_vectors(qdrant, owner_id=user.id, document_id=document_id)
    finally:
        await qdrant.close()
    Path(document["stored_path"]).unlink(missing_ok=True)
    await database.documents.update_one(
        {"document_id": document_id, "owner_id": user.id, "active": True},
        {"$set": {"active": False, "status": "deleted", "updated_at": datetime.now(timezone.utc)}},
    )
