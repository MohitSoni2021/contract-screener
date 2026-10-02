import asyncio
import logging
import os
import socket
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

from pymongo import AsyncMongoClient, ReturnDocument

from app.config import database_name, required_setting
from app.services.ingestion import ingest_document

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
            ]
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


async def run_worker() -> None:
    mongo_client = AsyncMongoClient(
        required_setting("MONGODB_URI"),
        serverSelectionTimeoutMS=8000,
    )
    database = mongo_client[database_name()]
    worker_id = f"{socket.gethostname()}:{os.getpid()}:{uuid4()}"
    try:
        await mongo_client.admin.command("ping")
        logger.info("Document ingestion worker started", extra={"worker_id": worker_id})
        while True:
            document = await _claim_document(database, worker_id)
            if document is None:
                await asyncio.sleep(POLL_INTERVAL_SECONDS)
                continue

            document_id = document["document_id"]
            heartbeat = asyncio.create_task(_renew_lease(database, document_id, worker_id))
            try:
                await ingest_document(database, document, Path(document["stored_path"]))
            except Exception:
                logger.exception("Ingestion worker failed", extra={"document_id": document_id})
            finally:
                heartbeat.cancel()
                try:
                    await heartbeat
                except asyncio.CancelledError:
                    pass
    finally:
        await mongo_client.close()


if __name__ == "__main__":
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    try:
        asyncio.run(run_worker())
    except KeyboardInterrupt:
        logger.info("Document ingestion worker stopped")
