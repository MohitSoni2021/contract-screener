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
