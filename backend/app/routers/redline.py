from __future__ import annotations

import logging
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

from app.dependencies import AuthenticatedUser, get_current_user, get_database
from app.routers.chat import _canonical_text, _owned_ready_document
from app.services.ai_client import chat_model, create_ai_client
from app.services.citations.verifier import SourceDocument
from app.services.redline.docx_xml import (
    DocxEdit,
    apply_tracked_changes_to_docx,
    create_docx_with_tracked_changes,
)
from app.services.redline.propose import propose_redline
from app.services.storage import get_document_bytes

router = APIRouter(prefix="/api/redline", tags=["redline"])
logger = logging.getLogger(__name__)


class RedlineProposeRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    document_id: str = Field(min_length=1, max_length=64, alias="documentId")
    instruction: str = Field(min_length=3, max_length=500)


class EditItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    target_text: str = Field(min_length=1, alias="targetText")
    revised_text: str = Field(min_length=1, alias="revisedText")


class RedlineApplyRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    document_id: str = Field(min_length=1, max_length=64, alias="documentId")
    edits: list[EditItem] = Field(min_length=1, max_length=20)


@router.post("")
async def propose_redline_endpoint(
    payload: RedlineProposeRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    database: Any = Depends(get_database),
) -> dict[str, Any]:
    document = await _owned_ready_document(database, user.id, payload.document_id)
    canonical = await _canonical_text(database, document)
    doc = SourceDocument(id=document["document_id"], name=document["filename"], full_text=canonical)

    ai_client = None
    try:
        ai_client = create_ai_client()
    except Exception:
        pass

    try:
        proposal = await propose_redline(
            doc,
            payload.instruction,
            ai_client=ai_client,
            chat_model_name=chat_model(),
        )
        return proposal.to_dict()
    finally:
        if ai_client is not None:
            await ai_client.close()


@router.post("/apply")
async def apply_redline_endpoint(
    payload: RedlineApplyRequest,
    user: AuthenticatedUser = Depends(get_current_user),
    database: Any = Depends(get_database),
) -> Response:
    document = await _owned_ready_document(database, user.id, payload.document_id)
    edits = [
        DocxEdit(target_text=e.target_text, revised_text=e.revised_text)
        for e in payload.edits
    ]

    original_bytes = await get_document_bytes(database, document)
    output_docx: bytes

    if document.get("extension") == ".docx" and original_bytes:
        try:
            output_docx = apply_tracked_changes_to_docx(original_bytes, edits)
        except Exception as exc:
            logger.warning("Could not apply in-place to original docx (%s); creating fresh package", exc)
            canonical = await _canonical_text(database, document)
            output_docx = create_docx_with_tracked_changes(canonical, edits)
    else:
        canonical = await _canonical_text(database, document)
        output_docx = create_docx_with_tracked_changes(canonical, edits)

    base_name = document["filename"].rsplit(".", 1)[0]
    safe_base = "".join(c if c.isalnum() or c in "_-." else "_" for c in base_name)
    download_filename = f"redlined-{safe_base}.docx"
    encoded_filename = quote(download_filename)

    return Response(
        content=output_docx,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={
            "Content-Disposition": f'attachment; filename="{download_filename}"; filename*=UTF-8\'\'{encoded_filename}',
            "Content-Length": str(len(output_docx)),
            "Cache-Control": "no-store",
        },
    )
