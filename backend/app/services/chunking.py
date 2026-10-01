from dataclasses import dataclass

from app.services.extraction import SourceBlock

CHUNK_SIZE = 3600
CHUNK_OVERLAP = 450
MIN_CHUNK_SIZE = 700


@dataclass(frozen=True)
class TextChunk:
    ordinal: int
    text: str
    char_start: int
    char_end: int
    page_start: int | None
    page_end: int | None
    block_start: int | None
    block_end: int | None


def chunk_document(text: str, blocks: list[SourceBlock]) -> list[TextChunk]:
    chunks: list[TextChunk] = []
    spans: list[tuple[int, int, SourceBlock]] = []
    cursor = 0
    for index, block in enumerate(blocks):
        start = cursor
        end = start + len(block.text)
        spans.append((start, end, block))
        cursor = end + (1 if index < len(blocks) - 1 else 0)

    start = 0
    while start < len(text):
        end = min(start + CHUNK_SIZE, len(text))
        if end < len(text):
            boundary = text.rfind("\n", start + MIN_CHUNK_SIZE, end)
            if boundary < start + MIN_CHUNK_SIZE:
                boundary = text.rfind(" ", start + MIN_CHUNK_SIZE, end)
            if boundary > start:
                end = boundary

        raw_chunk = text[start:end]
        leading_space = len(raw_chunk) - len(raw_chunk.lstrip())
        trimmed_text = raw_chunk.strip()
        if trimmed_text:
            chunk_start = start + leading_space
            chunk_end = chunk_start + len(trimmed_text)
            overlapping = [
                block for block_start, block_end, block in spans
                if block_start < chunk_end and block_end > chunk_start
            ]
            pages = [block.page_number for block in overlapping if block.page_number is not None]
            block_numbers = [block.block_number for block in overlapping]
            chunks.append(
                TextChunk(
                    ordinal=len(chunks),
                    text=trimmed_text,
                    char_start=chunk_start,
                    char_end=chunk_end,
                    page_start=min(pages) if pages else None,
                    page_end=max(pages) if pages else None,
                    block_start=min(block_numbers) if block_numbers else None,
                    block_end=max(block_numbers) if block_numbers else None,
                )
            )

        if end >= len(text):
            break
        start = max(start + 1, end - CHUNK_OVERLAP)

    return chunks
