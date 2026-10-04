import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pymongo import AsyncMongoClient
from pymongo.errors import OperationFailure

from app.config import cors_origins, database_name, required_setting
from app.routers import auth, chat, compare, documents, redline, research
from app.worker import run_worker_loop


@asynccontextmanager
async def lifespan(app: FastAPI):
    mongo_client = AsyncMongoClient(
        required_setting("MONGODB_URI"),
        serverSelectionTimeoutMS=8000,
    )
    app.state.mongo_client = mongo_client
    app.state.database = mongo_client[database_name()]
    worker_task: asyncio.Task | None = None
    try:
        await mongo_client.admin.command("ping")
        await app.state.database.users.create_index("email", unique=True)
        await app.state.database.revoked_tokens.create_index("token_id", unique=True)
        await app.state.database.revoked_tokens.create_index(
            "expires_at", expireAfterSeconds=0, name="revoked_token_expiry"
        )
        try:
            await app.state.database.documents.drop_index("one_active_document_per_owner")
        except OperationFailure:
            pass
        await app.state.database.documents.create_index(
            [("owner_id", 1), ("active", 1), ("created_at", -1)],
            name="active_documents_by_owner",
        )
        await app.state.database.documents.create_index(
            [("document_id", 1), ("owner_id", 1)],
            unique=True,
            name="document_owner_unique",
        )
        await app.state.database.documents.create_index(
            [("status", 1), ("lease_expires_at", 1), ("created_at", 1)],
            name="document_ingestion_queue",
        )
        await app.state.database.conversations.create_index(
            [("owner_id", 1), ("document_id", 1), ("updated_at", -1)],
            name="conversation_history_by_document",
        )
        await app.state.database.messages.create_index(
            [("conversation_id", 1), ("owner_id", 1), ("created_at", 1)],
            name="messages_by_conversation",
        )
        worker_task = asyncio.create_task(run_worker_loop(app.state.database))
        yield
    finally:
        if worker_task is not None:
            worker_task.cancel()
            try:
                await worker_task
            except asyncio.CancelledError:
                pass
        await mongo_client.close()


app = FastAPI(title="Elcara API", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    expose_headers=["Content-Disposition"],
)

app.include_router(auth.router)
app.include_router(documents.router)
app.include_router(chat.router)
app.include_router(chat.chats_router)
app.include_router(chat.citations_router)
app.include_router(research.router)
app.include_router(research.agent_router)
app.include_router(compare.router)
app.include_router(redline.router)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "elcara-api"}
