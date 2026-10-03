import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import httpx
import fitz
import pytest
from docx import Document
from fastapi import HTTPException

from app.routers.documents import validate_upload_content
from app.routers import chat
from app.routers.chat import _verified_sources
from app.routers.research import (
    build_document_index,
    is_repeated_tool_call,
    validate_tool_call,
)
from app.services.extraction import extract_document
from app.services.comparison import compare_documents
from app.services.extraction import ExtractedDocument, SourceBlock


def make_pdf(path: Path, text: str) -> None:
    document = fitz.open()
    page = document.new_page()
    page.insert_text((72, 72), text)
    document.save(path)
    document.close()


def test_upload_validation_rejects_empty_invalid_and_oversized_files():
    cases = [
        (".pdf", 0, b"", 1024, 400),
        (".pdf", 10, b"not a pdf", 1024, 415),
        (".docx", 10, b"not a zip", 1024, 415),
        (".pdf", 2048, b"%PDF-1.7", 1024, 413),
    ]
    for extension, size, header, limit, expected_status in cases:
        with pytest.raises(HTTPException) as error:
            validate_upload_content(extension, size, header, limit)
        assert error.value.status_code == expected_status


def test_pdf_extraction_preserves_page_locations_and_rejects_scanned_pdf(tmp_path: Path):
    path = tmp_path / "contract.pdf"
    make_pdf(path, "Payment is due within thirty days.")
    extracted = extract_document(path, ".pdf")
    assert extracted.text == "Payment is due within thirty days."
    assert extracted.page_count == 1
    assert extracted.blocks[0].page_number == 1

    image_only = fitz.open()
    image_only.new_page()
    scanned_path = tmp_path / "scanned.pdf"
    image_only.save(scanned_path)
    image_only.close()
    assert extract_document(scanned_path, ".pdf").text == ""


def test_docx_extraction_includes_table_content(tmp_path: Path):
    path = tmp_path / "terms.docx"
    document = Document()
    document.add_paragraph("Commercial terms")
    table = document.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "Term"
    table.cell(0, 1).text = "Value"
    table.cell(1, 0).text = "Notice"
    table.cell(1, 1).text = "30 days"
    document.save(path)

    extracted = extract_document(path, ".docx")
    assert "Term | Value" in extracted.text
    assert "Notice | 30 days" in extracted.text


def test_quote_verification_rejects_wrong_source_and_accepts_normalized_text():
    document = {
        "owner_id": "owner-1",
        "document_id": "document-1",
    }
    class Point:
        id = "point-1"
        score = 0.9
        payload = {
            "owner_id": "owner-1",
            "document_id": "document-1",
            "active": True,
            "text": "The  payment\n is due.",
            "char_start": 0,
            "char_end": len("The payment is due."),
            "chunk_id": "chunk-1",
        }

    sources = _verified_sources(document, "The payment is due.", [Point()])
    assert len(sources) == 1
    assert sources[0]["verified"] is True

    Point.payload = {**Point.payload, "document_id": "other-document"}
    assert _verified_sources(document, "The payment is due.", [Point()]) == []


def test_document_comparison_classifies_material_and_non_material_changes():
    old = ExtractedDocument("", [
        SourceBlock("The fee is $10,000.", 0, 1),
        SourceBlock("Supplier liability is capped at $50,000.", 1, 1),
        SourceBlock("Notice must be given in writing.", 2, 1),
    ], 1)
    new = ExtractedDocument("", [
        SourceBlock("The fee is $12,000.", 0, 1),
        SourceBlock("Notice must be given in writing.", 1, 1),
        SourceBlock("Supplier liability is capped at $100,000.", 2, 1),
        SourceBlock("A new audit clause applies.", 3, 1),
    ], 1)
    changes = compare_documents(old, new, "old", "new")
    assert any(change["significance"] == "substantive" and "$10,000" in change["old"]["text"] for change in changes)
    assert sum(change["change_type"] == "moved" for change in changes) == 2
    assert any(change["change_type"] == "inserted" for change in changes)


def test_document_comparison_detects_formatting_only_and_wording_changes():
    old = ExtractedDocument("", [SourceBlock("Payment is due within 30 days.", 0, 1)], 1)
    new = ExtractedDocument("", [SourceBlock("Payment is due within 30 days", 0, 1)], 1)
    assert compare_documents(old, new, "old", "new")[0]["change_type"] == "formatting"
    new = ExtractedDocument("", [SourceBlock("Payment must be made within 30 days.", 0, 1)], 0)
    assert compare_documents(old, new, "old", "new")[0]["change_type"] == "wording"


def test_contract_index_builds_clause_and_definition_index():
    contract = """
    1. Termination
    Either party may terminate for cause.
    1.1 Renewal
    This Agreement renews automatically unless notice is given.
    Definitions. "Confidential Information" means any non-public information.
    Section 5. Liability. Supplier liability is capped at $50,000.
    """
    index = build_document_index(contract)
    assert index["quality"] in {"strong", "weak"}
    assert len(index["clauses"]) >= 3
    assert any(clause["number"] == "1.1" for clause in index["clauses"])
    assert any(item["term"] == "Confidential Information" for item in index["definitions"])


def test_agent_tool_validation_rejects_unknown_and_invalid_calls():
    error = validate_tool_call("foo", '{"q": "x"}')
    assert "unknown tool" in error.lower()
    assert "list_clauses" in error

    error = validate_tool_call("get_section", '{"number": 9999}')
    assert "number" in error.lower()


def test_agent_repeated_call_detector_and_round_cap_guard():
    call = {"tool": "search_document", "arguments": {"query": "termination"}}
    assert is_repeated_tool_call(call, [call]) is True
    assert is_repeated_tool_call(call, []) is False


class FakeMessages:
    def __init__(self):
        self.updates = []

    async def update_one(self, query, update):
        self.updates.append((query, update))


class FakeConversations:
    def __init__(self):
        self.updates = []

    async def update_one(self, query, update):
        self.updates.append((query, update))


class FakeDatabase:
    def __init__(self):
        self.messages = FakeMessages()
        self.conversations = FakeConversations()


class FakeRequest:
    def __init__(self, disconnected=False):
        self.disconnected = disconnected

    async def is_disconnected(self):
        return self.disconnected


class FakeStream:
    def __init__(self, chunks):
        self.chunks = chunks
        self.closed = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self.chunks:
            raise StopAsyncIteration
        chunk = self.chunks.pop(0)
        if isinstance(chunk, BaseException):
            raise chunk
        return chunk

    async def close(self):
        self.closed = True


class BlockingStream(FakeStream):
    def __init__(self, first_chunk):
        super().__init__([first_chunk])
        self.block = asyncio.Event()

    async def __anext__(self):
        if self.chunks:
            return self.chunks.pop(0)
        await self.block.wait()
        raise StopAsyncIteration


class FakeAIClient:
    def __init__(self, stream=None, error=None):
        self.stream = stream
        self.error = error
        self.closed = False
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    async def create(self, **kwargs):
        if self.error:
            raise self.error
        return self.stream

    async def close(self):
        self.closed = True


class FakeQdrant:
    def __init__(self):
        self.closed = False

    async def close(self):
        self.closed = True


def make_chat_chunk(text):
    return SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=text))])


async def completed(value):
    return value


def make_chat_dependencies(monkeypatch, *, stream=None, ai_error=None):
    ai_client = FakeAIClient(stream=stream, error=ai_error)
    qdrant = FakeQdrant()
    monkeypatch.setattr(chat, "create_ai_client", lambda: ai_client)
    monkeypatch.setattr(chat, "create_qdrant_client", lambda: qdrant)
    monkeypatch.setattr(
        chat,
        "_canonical_text",
        lambda database, document: completed("Payment is due within thirty days."),
    )
    monkeypatch.setattr(
        chat,
        "_retrieve_sources",
        lambda **kwargs: completed([{
            "source_id": "S1",
            "chunk_id": "chunk-1",
            "quote": "Payment is due within thirty days.",
            "verified": True,
        }]),
    )
    return ai_client, qdrant


def make_stream_generator(database, request, user=None, question="When is payment due?"):
    return chat._send_message_events(
        request=request,
        database=database,
        user=user or SimpleNamespace(id="owner-1"),
        document={"document_id": "document-1", "owner_id": "owner-1", "status": "ready"},
        conversation_id="conversation-1",
        assistant_message_id="assistant-1",
        question=question,
        history=[],
    )


def decode_events(events):
    decoded = []
    for event in events:
        lines = event.splitlines()
        decoded.append((lines[0].removeprefix("event: "), json.loads(lines[1].removeprefix("data: "))))
    return decoded


async def collect_events(generator):
    return [event async for event in generator]


def test_chat_stream_completion_persists_answer_and_closes_resources(monkeypatch):
    stream = FakeStream([make_chat_chunk("Payment is due [[S1]].")])
    ai_client, qdrant = make_chat_dependencies(monkeypatch, stream=stream)
    database = FakeDatabase()

    events = asyncio.run(collect_events(make_stream_generator(database, FakeRequest())))
    decoded = decode_events(events)

    assert decoded[-1][0] == "done"
    assert decoded[-1][1]["status"] == "complete"
    persisted = database.messages.updates[-1][1]["$set"]
    assert persisted["status"] == "complete"
    assert persisted["content"] == "Payment is due [[S1]]."
    assert persisted["citations"][0]["source_id"] == "S1"
    assert stream.closed is True
    assert ai_client.closed is True
    assert qdrant.closed is True


def test_chat_stream_client_disconnect_persists_cancelled_partial_answer(monkeypatch):
    stream = FakeStream([make_chat_chunk("Partial answer")])
    make_chat_dependencies(monkeypatch, stream=stream)
    database = FakeDatabase()

    events = asyncio.run(collect_events(make_stream_generator(database, FakeRequest(disconnected=True))))
    decoded = decode_events(events)

    done = next(data for name, data in decoded if name == "done")
    assert done["status"] == "cancelled"
    persisted = database.messages.updates[-1][1]["$set"]
    assert persisted["status"] == "cancelled"
    assert persisted["content"] == ""


def test_chat_stream_task_cancellation_persists_partial_answer_and_closes_resources(monkeypatch):
    stream = BlockingStream(make_chat_chunk("Partial answer"))
    ai_client, qdrant = make_chat_dependencies(monkeypatch, stream=stream)
    database = FakeDatabase()

    async def cancel_while_streaming():
        task = asyncio.create_task(collect_events(make_stream_generator(database, FakeRequest())))
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(cancel_while_streaming())

    persisted = database.messages.updates[-1][1]["$set"]
    assert persisted["status"] == "cancelled"
    assert persisted["content"] == "Partial answer"
    assert ai_client.closed is True
    assert qdrant.closed is True


def test_chat_stream_partial_document_review_is_persisted_as_complete(monkeypatch):
    stream = FakeStream([make_chat_chunk("The covered section says [[S1]].")])
    make_chat_dependencies(monkeypatch, stream=stream)
    database = FakeDatabase()

    async def partial_sources(**kwargs):
        return [{"source_id": "S1", "chunk_id": "chunk-1", "quote": "covered", "verified": True}], {
            "mode": "broad", "complete": False, "covered_chunks": 1, "total_chunks": 4,
        }

    monkeypatch.setattr(chat, "_retrieve_broad_sources", partial_sources)
    events = asyncio.run(collect_events(make_stream_generator(database, FakeRequest(), question="Give an overview.")))

    persisted = database.messages.updates[-1][1]["$set"]
    assert persisted["status"] == "complete"
    assert "partial document-wide review" in persisted["content"]
    assert persisted["coverage"]["complete"] is False


def test_chat_stream_timeout_emits_retryable_error_and_persists_failure(monkeypatch):
    timeout = httpx.TimeoutException("qdrant timed out")
    make_chat_dependencies(monkeypatch, ai_error=timeout)
    database = FakeDatabase()

    events = asyncio.run(collect_events(make_stream_generator(database, FakeRequest())))
    decoded = decode_events(events)

    error = next(data for name, data in decoded if name == "error")
    assert "timed out" in error["message"]
    assert not any(name == "done" for name, _ in decoded)
    assert database.messages.updates[-1][1]["$set"]["status"] == "failed"