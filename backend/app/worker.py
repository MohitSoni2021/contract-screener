import asyncio
import logging
import os
import socket
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from pymongo import AsyncMongoClient, ReturnDocument

from app.config import database_name, required_setting
from app.services.ingestion import ingest_document
from app.services.storage import get_document_bytes

logger = logging.getLogger("elcara.worker")
POLL_INTERVAL_SECONDS = 2
HEARTBEAT_INTERVAL_SECONDS = 30
LEASE_DURATION_SECONDS = 180
RECOVERABLE_STATUSES = ["extracting", "chunking", "embedding", "indexing"]


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _claim_document(database, worker_id: str) -> dict | None:
    now = _now()
    return await database.documents.find_one_and_update(
        {
            "active": True,
            "$or": [
                {"status": "queued"},
                {
                    "status": {"$in": RECOVERABLE_STATUSES},
                    "$or": [
                        {"lease_expires_at": {"$lte": now}},
                        {"lease_expires_at": {"$exists": False}},
                    ],
                },
            ],
        },
        {
            "$set": {
                "status": "extracting",
                "stage": "Ingestion worker claimed the document",
                "worker_id": worker_id,
                "lease_expires_at": now + timedelta(seconds=LEASE_DURATION_SECONDS),
                "updated_at": now,
            }
        },
        sort=[("created_at", 1)],
        return_document=ReturnDocument.AFTER,
    )


async def _renew_lease(database, document_id: str, worker_id: str) -> None:
    while True:
        await asyncio.sleep(HEARTBEAT_INTERVAL_SECONDS)
        result = await database.documents.update_one(
            {"document_id": document_id, "worker_id": worker_id},
            {
                "$set": {
                    "lease_expires_at": _now() + timedelta(seconds=LEASE_DURATION_SECONDS),
                    "updated_at": _now(),
                }
            },
        )
        if result.matched_count == 0:
            logger.warning("Ingestion lease was lost", extra={"document_id": document_id})
            return


async def process_claimed_document(
    database: Any,
    document: dict,
    worker_id: str,
    file_bytes: bytes | None = None,
) -> bool:
    document_id = document["document_id"]
    if file_bytes is None:
        file_bytes = await get_document_bytes(database, document)

    if file_bytes is None:
        logger.error("Document file not found in database or storage", extra={"document_id": document_id})
        await database.documents.update_one(
            {"document_id": document_id, "worker_id": worker_id},
            {
                "$set": {
                    "status": "failed",
                    "stage": "Processing failed",
                    "error": "The document file is missing or unavailable.",
                    "updated_at": _now(),
                },
                "$unset": {"worker_id": "", "lease_expires_at": ""},
            },
        )
        return False

    heartbeat = asyncio.create_task(_renew_lease(database, document_id, worker_id))
    try:
        await ingest_document(
            database,
            document,
            file_source=file_bytes,
            worker_id=worker_id,
        )
        return True
    except Exception:
        logger.exception("Ingestion worker failed", extra={"document_id": document_id})
        return False
    finally:
        heartbeat.cancel()
        try:
            await heartbeat
        except asyncio.CancelledError:
            pass


async def claim_and_process_document(
    database: Any,
    worker_id: str | None = None,
    document_id: str | None = None,
    file_bytes: bytes | None = None,
) -> bool:
    worker_id = worker_id or f"{socket.gethostname()}:{os.getpid()}:{uuid4()}"
    now = _now()
    if document_id is not None:
        document = await database.documents.find_one_and_update(
            {
                "document_id": document_id,
                "active": True,
                "$or": [
                    {"status": "queued"},
                    {
                        "status": {"$in": RECOVERABLE_STATUSES},
                        "$or": [
                            {"lease_expires_at": {"$lte": now}},
                            {"lease_expires_at": {"$exists": False}},
                        ],
                    },
                ],
            },
            {
                "$set": {
                    "status": "extracting",
                    "stage": "Ingestion worker claimed the document",
                    "worker_id": worker_id,
                    "lease_expires_at": now + timedelta(seconds=LEASE_DURATION_SECONDS),
                    "updated_at": now,
                }
            },
            return_document=ReturnDocument.AFTER,
        )
    else:
        document = await _claim_document(database, worker_id)

    if document is None:
        return False

    return await process_claimed_document(database, document, worker_id, file_bytes=file_bytes)


async def run_worker_loop(database: Any, worker_id: str | None = None) -> None:
    worker_id = worker_id or f"{socket.gethostname()}:{os.getpid()}:{uuid4()}"
    logger.info("Ingestion worker loop started", extra={"worker_id": worker_id})
    while True:
        try:
            processed = await claim_and_process_document(database, worker_id=worker_id)
            if not processed:
                await asyncio.sleep(POLL_INTERVAL_SECONDS)
        except asyncio.CancelledError:
            logger.info("Ingestion worker loop cancelled")
            break
        except Exception:
            logger.exception("Unexpected error in document ingestion loop")
            await asyncio.sleep(POLL_INTERVAL_SECONDS)


async def run_worker() -> None:
    mongo_client = AsyncMongoClient(
        required_setting("MONGODB_URI"),
        serverSelectionTimeoutMS=8000,
    )
    database = mongo_client[database_name()]
    try:
        await mongo_client.admin.command("ping")
        await run_worker_loop(database)
    finally:
        await mongo_client.close()


if __name__ == "__main__":
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    try:
        asyncio.run(run_worker())
    except KeyboardInterrupt:
        logger.info("Document ingestion worker stopped")

