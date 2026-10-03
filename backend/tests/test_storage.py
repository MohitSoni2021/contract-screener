import pytest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from app.services.storage import (
    ensure_local_file,
    is_storage_configured,
    upload_file_to_storage,
    download_file_from_storage,
    delete_file_from_storage,
)


def test_is_storage_configured_false_by_default():
    with patch("app.services.storage.supabase_url", return_value=""), \
         patch("app.services.storage.supabase_key", return_value=""):
        assert not is_storage_configured()


def test_is_storage_configured_true_when_vars_set():
    with patch("app.services.storage.supabase_url", return_value="https://xyz.supabase.co"), \
         patch("app.services.storage.supabase_key", return_value="some-key"):
        assert is_storage_configured()


@pytest.mark.anyio
async def test_ensure_local_file_returns_path_if_already_present(tmp_path: Path):
    local_file = tmp_path / "sample.pdf"
    local_file.write_text("dummy content")

    document = {
        "document_id": "doc123",
        "owner_id": "user123",
        "extension": ".pdf",
        "stored_path": str(local_file),
    }

    result = await ensure_local_file(document)
    assert result == local_file
    assert result.is_file()


@pytest.mark.anyio
async def test_ensure_local_file_restores_from_storage_when_missing(tmp_path: Path):
    missing_file = tmp_path / "sub" / "missing.pdf"
    assert not missing_file.exists()

    document = {
        "document_id": "doc123",
        "owner_id": "user123",
        "extension": ".pdf",
        "stored_path": str(missing_file),
        "storage_path": "user123/doc123.pdf",
    }

    async def fake_download(storage_path, target_path):
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_bytes(b"%PDF-test")
        return True

    with patch("app.services.storage.download_file_from_storage", side_effect=fake_download):
        result = await ensure_local_file(document)
        assert result == missing_file
        assert result.is_file()
        assert result.read_bytes() == b"%PDF-test"


@pytest.mark.anyio
async def test_database_gridfs_storage_roundtrip():
    from app.services.storage import (
        store_file_in_database,
        get_file_bytes_from_database,
        delete_file_from_database,
        get_document_bytes,
        delete_document_file,
    )
    from bson import ObjectId

    fake_files = {}

    class FakeGridIn:
        def __init__(self, file_id):
            self._id = file_id

        async def write(self, data):
            fake_files[self._id] = data

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc_val, exc_tb):
            pass

    class FakeGridOut:
        def __init__(self, data):
            self.data = data

        async def read(self):
            return self.data

    class FakeBucket:
        def __init__(self, db, bucket_name="document_files"):
            self.db = db

        def open_upload_stream(self, filename, chunk_size_bytes=None, metadata=None, session=None):
            file_id = ObjectId()
            return FakeGridIn(file_id)

        async def upload_from_stream(self, filename, source, metadata=None):
            file_id = ObjectId()
            fake_files[file_id] = source
            return file_id

        async def open_download_stream(self, file_id):
            if file_id not in fake_files:
                raise Exception("No such file")
            return FakeGridOut(fake_files[file_id])

        async def delete(self, file_id):
            fake_files.pop(file_id, None)

    fake_db = {}
    with patch("app.services.storage.get_gridfs_bucket", side_effect=lambda db, **kw: FakeBucket(db)):
        content = b"%PDF-1.4 test document content"
        file_id = await store_file_in_database(fake_db, "test.pdf", content)
        assert file_id in fake_files

        # Retrieve
        fetched = await get_file_bytes_from_database(fake_db, file_id)
        assert fetched == content

        # get_document_bytes
        doc = {"document_id": "doc-1", "gridfs_id": file_id}
        doc_bytes = await get_document_bytes(fake_db, doc)
        assert doc_bytes == content

        # delete_document_file
        await delete_document_file(fake_db, doc)
        assert file_id not in fake_files
        assert await get_document_bytes(fake_db, doc) is None

