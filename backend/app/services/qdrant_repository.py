from uuid import NAMESPACE_URL, uuid5

from qdrant_client import AsyncQdrantClient, models

from app.config import qdrant_timeout_seconds, setting
from app.services.chunking import TextChunk


def document_scope(
    owner_id: str,
    document_id: str,
    *,
    active_only: bool = False,
    index_version: int | None = None,
) -> models.Filter:
    """The single mandatory ownership filter used for document vector operations."""
    conditions = [
        models.FieldCondition(key="owner_id", match=models.MatchValue(value=owner_id)),
        models.FieldCondition(key="document_id", match=models.MatchValue(value=document_id)),
    ]
    if active_only:
        conditions.append(
            models.FieldCondition(key="active", match=models.MatchValue(value=True))
        )
    if index_version is not None:
        conditions.append(
            models.FieldCondition(
                key="index_version", match=models.MatchValue(value=index_version)
            )
        )
    return models.Filter(
        must=conditions
    )


def create_qdrant_client() -> AsyncQdrantClient:
    # Prefer the cloud/online cluster endpoint when provided.
    # QDRANT_CLUSTER_ENDPOINT is the canonical name for Qdrant Cloud URLs;
    # QDRANT_URL is kept for backward-compat with local setups.
    url = (
        setting("QDRANT_CLUSTER_ENDPOINT")
        or setting("QDRANT_URL", "http://localhost:6333")
    )
    api_key = setting("QDRANT_API_KEY") or None
    return AsyncQdrantClient(url=url, api_key=api_key, timeout=qdrant_timeout_seconds())


def collection_name() -> str:
    return setting("QDRANT_COLLECTION", "document_chunks")


async def ensure_collection(client: AsyncQdrantClient, vector_size: int) -> None:
    name = collection_name()
    if await client.collection_exists(name):
        info = await client.get_collection(name)
        vector_config = info.config.params.vectors
        if isinstance(vector_config, models.VectorParams) and vector_config.size != vector_size:
            raise ValueError(
                f"Qdrant collection '{name}' uses {vector_config.size}-dimension vectors; "
                f"the configured embedding model returns {vector_size}. Recreate or reindex the collection."
            )
        return

    await client.create_collection(
        collection_name=name,
        vectors_config=models.VectorParams(size=vector_size, distance=models.Distance.COSINE),
    )
    for field_name, field_type in (
        ("owner_id", models.PayloadSchemaType.KEYWORD),
        ("document_id", models.PayloadSchemaType.KEYWORD),
        ("active", models.PayloadSchemaType.BOOL),
        ("index_version", models.PayloadSchemaType.INTEGER),
    ):
        await client.create_payload_index(
            collection_name=name,
            field_name=field_name,
            field_schema=field_type,
        )


def vector_point_id(document_id: str, index_version: int, ordinal: int) -> str:
    return str(uuid5(NAMESPACE_URL, f"elcara:{document_id}:{index_version}:{ordinal}"))


def make_point(
    *,
    owner_id: str,
    document_id: str,
    index_version: int,
    chunk: TextChunk,
    vector: list[float],
) -> models.PointStruct:
    return models.PointStruct(
        id=vector_point_id(document_id, index_version, chunk.ordinal),
        vector=vector,
        payload={
            "owner_id": owner_id,
            "document_id": document_id,
            "chunk_id": vector_point_id(document_id, index_version, chunk.ordinal),
            "index_version": index_version,
            "active": True,
            "ordinal": chunk.ordinal,
            "text": chunk.text,
            "char_start": chunk.char_start,
            "char_end": chunk.char_end,
            "page_start": chunk.page_start,
            "page_end": chunk.page_end,
            "block_start": chunk.block_start,
            "block_end": chunk.block_end,
        },
    )


async def delete_document_vectors(
    client: AsyncQdrantClient,
    *,
    owner_id: str,
    document_id: str,
) -> None:
    name = collection_name()
    if await client.collection_exists(name):
        await client.delete(
            collection_name=name,
            points_selector=document_scope(owner_id, document_id),
            wait=True,
        )
