from pathlib import Path

import fitz
import pytest
from docx import Document
from fastapi import HTTPException

from app.routers.documents import validate_upload_content
from app.routers.chat import _verified_sources
from app.services.extraction import extract_document


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