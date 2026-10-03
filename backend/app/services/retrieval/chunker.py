from __future__ import annotations

from dataclasses import dataclass
import re

from app.services.citations.locator import SourcePage, page_for_offset

DEFAULT_CHUNK_CHARS = 2800
DEFAULT_OVERLAP_CHARS = 400


@dataclass(frozen=True)
class ChunkDraft:
    page_start: int
    page_end: int
    text: str
    start_offset: int
    end_offset: int

    def to_dict(self) -> dict:
        return {
            "page_start": self.page_start,
            "page_end": self.page_end,
            "text": self.text,
            "start_offset": self.start_offset,
            "end_offset": self.end_offset,
            "startOffset": self.start_offset,
            "endOffset": self.end_offset,
            "pageStart": self.page_start,
            "pageEnd": self.page_end,
        }


@dataclass(frozen=True)
class Segment:
    start: int
    end: int


def _split_into_segments(text: str, max_chars: number) -> list[Segment]:
    segments: list[Segment] = []
    paragraph_re = re.compile(r"\S[\s\S]*?(?=\n\s*\n|$)", re.MULTILINE)
    for match in paragraph_re.finditer(text):
        pos = match.start()
        end = match.end()
        while end - pos > max_chars:
            limit = pos + max_chars
            sentence = text.rfind(". ", pos, limit)
            space = text.rfind(" ", pos, limit)
            cut = sentence + 2 if sentence > pos + max_chars // 2 else space + 1 if space > pos else limit
            segments.append(Segment(start=pos, end=cut))
            pos = cut
        if end > pos:
            segments.append(Segment(start=pos, end=end))
    return segments


def chunk_document(
    full_text: str,
    pages: list[SourcePage],
    size: int = DEFAULT_CHUNK_CHARS,
    overlap: int = DEFAULT_OVERLAP_CHARS,
) -> list[ChunkDraft]:
    """Paragraph-aware chunking matching Refer chunker.ts.
    Every chunk records exact source offsets and its page range.
    """
    segments = _split_into_segments(full_text, size)
    chunks: list[ChunkDraft] = []
    i = 0
    while i < len(segments):
        j = i
        while j + 1 < len(segments) and (segments[j + 1].end - segments[i].start) <= size:
            j += 1
        start = segments[i].start
        end = segments[j].end
        chunks.append(
            ChunkDraft(
                text=full_text[start:end],
                start_offset=start,
                end_offset=end,
                page_start=page_for_offset(pages, start),
                page_end=page_for_offset(pages, max(start, end - 1)),
            )
        )
        if j == len(segments) - 1:
            break
        next_idx = j + 1
        while next_idx - 1 > i and (segments[j].end - segments[next_idx - 1].start) <= overlap:
            next_idx -= 1
        i = next_idx
    return chunks
