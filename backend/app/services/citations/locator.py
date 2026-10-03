from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SourcePage:
    page_number: int
    start_offset: int  # Offset of the page's first character inside the document's full text
    text: str


def page_for_offset(pages: list[SourcePage], offset: int) -> int:
    """Returns the page containing a document offset. Pages must be sorted by start_offset."""
    if not pages:
        return 1
    found = pages[0].page_number
    for page in pages:
        if page.start_offset <= offset:
            found = page.page_number
        else:
            break
    return found
