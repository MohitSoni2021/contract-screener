import re
from typing import Any

from app.services.extraction import SourceBlock

STRUCTURE_VERSION = 1
_HEADING = re.compile(
    r"^(?:(?:chapter|part|section)\s+[\wIVXLC-]+(?:\s*[:.-].*)?|(?:\d+(?:\.\d+)*)[.)]?\s+.+|[A-Z][A-Z0-9][A-Z0-9\s:,&'()/-]{4,})$",
    re.IGNORECASE,
)
_CONTENTS = re.compile(r"\b(table\s+of\s+contents|contents|index)\b", re.IGNORECASE)


def extract_structure(text: str, blocks: list[SourceBlock]) -> dict[str, Any]:
    lines = text.splitlines()
    outlines: list[dict[str, Any]] = []
    cursor = 0
    for line in lines:
        value = line.strip()
        if value and _HEADING.match(value) and len(value) <= 180:
            char_start = text.find(line, cursor)
            if char_start >= 0:
                outlines.append({
                    "title": value,
                    "char_start": char_start,
                    "char_end": char_start + len(line),
                })
                cursor = char_start + len(line)

    contents_lines: list[str] = []
    contents_start = None
    for index, line in enumerate(lines):
        if _CONTENTS.search(line):
            contents_start = index
            break
    if contents_start is not None:
        contents_lines = [line.strip() for line in lines[contents_start:contents_start + 80] if line.strip()]

    return {
        "version": STRUCTURE_VERSION,
        "complete": bool(outlines),
        "headings": outlines[:500],
        "contents": "\n".join(contents_lines),
        "source_block_count": len(blocks),
    }