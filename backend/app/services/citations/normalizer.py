from __future__ import annotations

from dataclasses import dataclass
import re

REPLACEMENTS: dict[str, str] = {
    "\u2018": "'",
    "\u2019": "'",
    "\u201c": '"',
    "\u201d": '"',
    "\u2013": "-",
    "\u2014": "-",
    "\u2212": "-",
    "\u00a0": " ",
    "\u00ad": "",
    "\ufb01": "fi",
    "\ufb02": "fl",
}

WHITESPACE_RE = re.compile(r"\s")


@dataclass(frozen=True)
class NormalizedText:
    text: str
    # map[i] is the index in the ORIGINAL string of normalized character i.
    map: list[int]


def normalize_with_map(original: str) -> NormalizedText:
    """Lower-cases, folds typographic characters and collapses whitespace, while remembering
    where every normalized character came from. The original text is never modified; the
    map is what lets a match in normalized space be turned back into real offsets.
    """
    text_chars: list[str] = []
    char_map: list[int] = []
    pending_space_at = -1

    for i, ch in enumerate(original):
        replaced = REPLACEMENTS.get(ch, ch).lower()
        for r_ch in replaced:
            if WHITESPACE_RE.match(r_ch):
                if text_chars and pending_space_at < 0:
                    pending_space_at = i
                continue
            if pending_space_at >= 0:
                text_chars.append(" ")
                char_map.append(pending_space_at)
                pending_space_at = -1
            text_chars.append(r_ch)
            char_map.append(i)

    return NormalizedText("".join(text_chars), char_map)


def normalize_quote(quote: str) -> str:
    return normalize_with_map(quote).text
