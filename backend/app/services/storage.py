import logging
from pathlib import Path
from typing import Any

import httpx

from app.config import setting

logger = logging.getLogger(__name__)


def supabase_url() -> str:
    return setting("SUPABASE_URL").rstrip("/")


def supabase_key() -> str:
    return setting("SUPABASE_SERVICE_ROLE_KEY") or setting("SUPABASE_KEY")


def supabase_bucket() -> str:
    return setting("SUPABASE_BUCKET", "documents")


def is_storage_configured() -> bool:
    return bool(supabase_url() and supabase_key())


async def ensure_bucket_exists(client: httpx.AsyncClient) -> None:
    """Ensure the configured Supabase storage bucket exists."""
    url = f"{supabase_url()}/storage/v1/bucket"
    key = supabase_key()
    headers = {
        "Authorization": f"Bearer {key}",
        "apikey": key,
        "Content-Type": "application/json",
    }
    bucket = supabase_bucket()
    try:
        response = await client.post(
            url,
            json={"id": bucket, "name": bucket, "public": False},
            headers=headers,
            timeout=10.0,
        )
        # 200/201 created; 400/409 means bucket already exists
        if response.status_code not in (200, 201, 400, 409):
            logger.warning(
                "Could not verify or create Supabase bucket '%s': HTTP %s %s",
                bucket,
                response.status_code,
                response.text,
            )
    except Exception as exc:
        logger.warning("Error checking Supabase bucket: %s", exc)


async def upload_file_to_storage(
    local_path: Path,
    storage_path: str,
    content_type: str = "application/octet-stream",
) -> bool:
    """Upload a file to Supabase Storage."""
    if not is_storage_configured():
        return False

    url = f"{supabase_url()}/storage/v1/object/{supabase_bucket()}/{storage_path}"
    key = supabase_key()
    headers = {
        "Authorization": f"Bearer {key}",
        "apikey": key,
        "Content-Type": content_type,
        "x-upsert": "true",
    }

    try:
        async with httpx.AsyncClient() as client:
            await ensure_bucket_exists(client)
            file_bytes = local_path.read_bytes()
            response = await client.post(url, content=file_bytes, headers=headers, timeout=60.0)
            if response.status_code in (200, 201):
                logger.info("Uploaded %s to Supabase storage (%s)", local_path.name, storage_path)
                return True
            logger.error(
                "Failed to upload %s to Supabase: HTTP %s %s",
                storage_path,
                response.status_code,
                response.text,
            )
            return False
    except Exception as exc:
        logger.exception("Exception uploading %s to Supabase storage: %s", storage_path, exc)
        return False


async def download_file_from_storage(storage_path: str, target_local_path: Path) -> bool:
    """Download a file from Supabase Storage to a local file path."""
    if not is_storage_configured():
        return False

    url = f"{supabase_url()}/storage/v1/object/authenticated/{supabase_bucket()}/{storage_path}"
    key = supabase_key()
    headers = {
        "Authorization": f"Bearer {key}",
        "apikey": key,
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=headers, timeout=60.0)
            if response.status_code == 200:
                target_local_path.parent.mkdir(parents=True, exist_ok=True)
                target_local_path.write_bytes(response.content)
                logger.info("Restored %s from Supabase storage", storage_path)
                return True
            logger.warning(
                "Could not download %s from Supabase: HTTP %s",
                storage_path,
                response.status_code,
            )
            return False
    except Exception as exc:
        logger.exception("Exception downloading %s from Supabase storage: %s", storage_path, exc)
        return False


async def delete_file_from_storage(storage_path: str) -> bool:
    """Delete a file from Supabase Storage."""
    if not is_storage_configured():
        return False

    url = f"{supabase_url()}/storage/v1/object/{supabase_bucket()}"
    key = supabase_key()
    headers = {
        "Authorization": f"Bearer {key}",
        "apikey": key,
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.request(
                "DELETE",
                url,
                json={"prefixes": [storage_path]},
                headers=headers,
                timeout=15.0,
            )
            return response.status_code == 200
    except Exception as exc:
        logger.warning("Could not delete %s from Supabase storage: %s", storage_path, exc)
        return False


async def ensure_local_file(document: dict[str, Any]) -> Path | None:
    """Ensure the document's file is present on the local disk.

    If missing locally (e.g. after a container restart or deployment on Render),
    downloads it from persistent cloud storage (Supabase).
    """
    path = Path(document["stored_path"])
    if path.is_file():
        return path

    storage_path = document.get("storage_path") or (
        f"{document.get('owner_id', 'unknown')}/{document['document_id']}{document['extension']}"
    )

    downloaded = await download_file_from_storage(storage_path, path)
    if downloaded and path.is_file():
        return path

    return None
