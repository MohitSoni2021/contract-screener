import logging
from pathlib import Path
from typing import Any

from bson import ObjectId
from gridfs import AsyncGridFSBucket
import httpx

from app.config import setting

logger = logging.getLogger(__name__)

DATABASE_BUCKET_NAME = "document_files"


def get_gridfs_bucket(database: Any, bucket_name: str = DATABASE_BUCKET_NAME) -> AsyncGridFSBucket:
    return AsyncGridFSBucket(database, bucket_name=bucket_name)


async def store_file_in_database(
    database: Any,
    filename: str,
    content: bytes,
    metadata: dict[str, Any] | None = None,
    bucket_name: str = DATABASE_BUCKET_NAME,
) -> ObjectId:
    """Store raw file content in MongoDB using GridFS."""
    bucket = get_gridfs_bucket(database, bucket_name=bucket_name)
    file_id = await bucket.upload_from_stream(
        filename=filename,
        source=content,
        metadata=metadata or {},
    )
    logger.info("Stored file '%s' in database GridFS with id %s", filename, file_id)
    return file_id


async def get_file_bytes_from_database(
    database: Any,
    file_id: Any,
    bucket_name: str = DATABASE_BUCKET_NAME,
) -> bytes | None:
    """Retrieve raw file content from MongoDB GridFS by file id."""
    bucket = get_gridfs_bucket(database, bucket_name=bucket_name)
    try:
        grid_out = await bucket.open_download_stream(file_id)
        return await grid_out.read()
    except Exception as exc:
        logger.warning("Could not retrieve file %s from database GridFS: %s", file_id, exc)
        return None


async def delete_file_from_database(
    database: Any,
    file_id: Any,
    bucket_name: str = DATABASE_BUCKET_NAME,
) -> bool:
    """Delete a file from MongoDB GridFS."""
    bucket = get_gridfs_bucket(database, bucket_name=bucket_name)
    try:
        await bucket.delete(file_id)
        logger.info("Deleted file %s from database GridFS", file_id)
        return True
    except Exception as exc:
        logger.warning("Could not delete file %s from database GridFS: %s", file_id, exc)
        return False


async def get_document_bytes(
    database: Any,
    document: dict[str, Any],
) -> bytes | None:
    """Get raw document bytes, prioritizing MongoDB GridFS."""
    gridfs_id = document.get("gridfs_id")
    if gridfs_id is not None:
        data = await get_file_bytes_from_database(database, gridfs_id)
        if data:
            return data

    if "file_data" in document and isinstance(document["file_data"], (bytes, bytearray)):
        return bytes(document["file_data"])

    # Fallback to local stored_path if present (legacy)
    stored_path = document.get("stored_path")
    if stored_path:
        local_path = Path(stored_path)
        if local_path.is_file():
            return local_path.read_bytes()

    # Fallback to Supabase cloud storage (legacy)
    storage_path = document.get("storage_path") or (
        f"{document.get('owner_id', 'unknown')}/{document.get('document_id')}{document.get('extension', '')}"
    )
    if is_storage_configured() and storage_path:
        try:
            url = f"{supabase_url()}/storage/v1/object/authenticated/{supabase_bucket()}/{storage_path}"
            headers = {"Authorization": f"Bearer {supabase_key()}", "apikey": supabase_key()}
            async with httpx.AsyncClient() as client:
                res = await client.get(url, headers=headers, timeout=60.0)
                if res.status_code == 200:
                    return res.content
        except Exception:
            pass

    return None


async def delete_document_file(database: Any, document: dict[str, Any]) -> None:
    """Delete document content from MongoDB GridFS and legacy locations."""
    gridfs_id = document.get("gridfs_id")
    if gridfs_id is not None:
        await delete_file_from_database(database, gridfs_id)

    stored_path = document.get("stored_path")
    if stored_path:
        Path(stored_path).unlink(missing_ok=True)

    storage_path = document.get("storage_path")
    if storage_path and is_storage_configured():
        await delete_file_from_storage(storage_path)


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


async def ensure_local_file(document: dict[str, Any], database: Any = None) -> Path | None:
    """Ensure the document's file is present on the local disk.

    Maintained for backwards-compatibility with test suites and legacy code.
    If database is provided or gridfs_id is present, it can also restore from MongoDB.
    """
    stored_path = document.get("stored_path")
    if stored_path:
        path = Path(stored_path)
        if path.is_file():
            return path
    elif document.get("document_id"):
        from app.config import BACKEND_DIR
        path = BACKEND_DIR / "data" / "uploads" / document.get("owner_id", "default") / f"{document['document_id']}{document.get('extension', '.pdf')}"
        if path.is_file():
            return path
    else:
        path = None

    if path is None and stored_path:
        path = Path(stored_path)

    if database is not None and path is not None:
        file_bytes = await get_document_bytes(database, document)
        if file_bytes:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(file_bytes)
            return path

    if path is not None:
        storage_path = document.get("storage_path") or (
            f"{document.get('owner_id', 'unknown')}/{document['document_id']}{document.get('extension', '')}"
        )
        downloaded = await download_file_from_storage(storage_path, path)
        if downloaded and path.is_file():
            return path

    return None

