from dataclasses import dataclass
from pathlib import Path

import fitz
from docx import Document
from docx.table import Table
from docx.text.paragraph import Paragraph


@dataclass(frozen=True)
class SourceBlock:
    text: str
    block_number: int
    page_number: int | None


@dataclass(frozen=True)
class ExtractedDocument:
    text: str
    blocks: list[SourceBlock]
    page_count: int | None


def _join_blocks(blocks: list[SourceBlock]) -> str:
    return "\n".join(block.text for block in blocks)


def extract_pdf(path: Path) -> ExtractedDocument:
    source_blocks: list[SourceBlock] = []
    with fitz.open(path) as document:
        page_count = document.page_count
        for page_number, page in enumerate(document, start=1):
            extracted = page.get_text("blocks", sort=True)
            for item in extracted:
                if len(item) < 7 or not isinstance(item[4], str):
                    continue
                text = item[4].strip()
                if text:
                    source_blocks.append(
                        SourceBlock(
                            text=text,
                            block_number=int(item[5]),
                            page_number=page_number,
                        )
                    )
    return ExtractedDocument(_join_blocks(source_blocks), source_blocks, page_count)


def _table_text(table: Table) -> str:
    rows = []
    for row in table.rows:
        cells = [" ".join(cell.text.split()) for cell in row.cells]
        if any(cells):
            rows.append(" | ".join(cells))
    return "\n".join(rows)


def extract_docx(path: Path) -> ExtractedDocument:
    document = Document(path)
    source_blocks: list[SourceBlock] = []

    for block_number, element in enumerate(document.iter_inner_content()):
        if isinstance(element, Paragraph):
            text = element.text.strip()
        elif isinstance(element, Table):
            text = _table_text(element).strip()
        else:
            continue
        if text:
            source_blocks.append(
                SourceBlock(text=text, block_number=block_number, page_number=None)
            )

    return ExtractedDocument(_join_blocks(source_blocks), source_blocks, None)


def extract_document(path: Path, extension: str) -> ExtractedDocument:
    if extension == ".pdf":
        return extract_pdf(path)
    if extension == ".docx":
        return extract_docx(path)
    raise ValueError("Only PDF and DOCX files are supported.")
