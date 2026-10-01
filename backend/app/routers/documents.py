from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.config import BACKEND_DIR
from app.dependencies import AuthenticatedUser, get_current_user

router = APIRouter(prefix="/api/documents", tags=["documents"])
UPLOAD_DIR = BACKEND_DIR / "data" / "uploads"
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
ALLOWED_EXTENSIONS = {".pdf", ".docx"}


@router.post("", status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    user: AuthenticatedUser = Depends(get_current_user),
) -> dict[str, Any]:
    extension = Path(file.filename or "").suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=415, detail="Only PDF and DOCX files are supported.")

    document_id = str(uuid4())
    user_upload_dir = UPLOAD_DIR / user.id
    saved_path = user_upload_dir / f"{document_id}{extension}"
    user_upload_dir.mkdir(parents=True, exist_ok=True)

    size = 0
    try:
        with saved_path.open("wb") as destination:
            while chunk := await file.read(1024 * 1024):
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

    return {
        "document_id": document_id,
        "filename": Path(file.filename or "document").name,
        "status": "uploaded",
    }
