from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pymongo import AsyncMongoClient

from app.config import cors_origins, database_name, required_setting
from app.routers import auth, documents


@asynccontextmanager
async def lifespan(app: FastAPI):
    mongo_client = AsyncMongoClient(
        required_setting("MONGODB_URI"),
        serverSelectionTimeoutMS=8000,
    )
    app.state.mongo_client = mongo_client
    app.state.database = mongo_client[database_name()]
    try:
        await mongo_client.admin.command("ping")
        await app.state.database.users.create_index("email", unique=True)
        await app.state.database.revoked_tokens.create_index("token_id", unique=True)
        await app.state.database.revoked_tokens.create_index(
            "expires_at", expireAfterSeconds=0, name="revoked_token_expiry"
        )
        yield
    finally:
        await mongo_client.close()


app = FastAPI(title="Elcara API", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(auth.router)
app.include_router(documents.router)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "elcara-api"}
