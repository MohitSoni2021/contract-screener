from __future__ import annotations

from dataclasses import dataclass
import re

WORD_TOKEN_RE = re.compile(r"\S+|\s+")


@dataclass
class DiffToken:
    op: str  # "same" | "deleted" | "inserted"
    text: str

    def to_dict(self) -> dict[str, str]:
        return {"op": self.op, "text": self.text}


def tokenize_words(text: str) -> list[str]:
    if not text:
        return []
    return WORD_TOKEN_RE.findall(text)


def _merge_tokens(tokens: list[DiffToken]) -> list[DiffToken]:
    merged: list[DiffToken] = []
    for t in tokens:
        if merged and merged[-1].op == t.op:
            merged[-1] = DiffToken(op=t.op, text=merged[-1].text + t.text)
        else:
            merged.append(DiffToken(op=t.op, text=t.text))
    return merged


def _cluster_edits(tokens: list[DiffToken], target_op: str) -> list[DiffToken]:
    result = list(tokens)
    changed = True
    while changed:
        changed = False
        next_tokens: list[DiffToken] = []
        k = 0
        while k < len(result):
            if (
                result[k].op == target_op
                and k + 2 < len(result)
                and result[k + 1].op == "same"
                and result[k + 1].text.strip() == ""
                and result[k + 2].op == target_op
            ):
                next_tokens.append(
                    DiffToken(
                        op=target_op,
                        text=result[k].text + result[k + 1].text + result[k + 2].text,
                    )
                )
                k += 3
                changed = True
            else:
                next_tokens.append(result[k])
                k += 1
        result = _merge_tokens(next_tokens)
    return result


def diff_words(
    left_text: str,
    right_text: str,
) -> tuple[list[DiffToken], list[DiffToken], bool]:
    """Computes word-level diff between two texts using an optimized SequenceMatcher.
    Returns separate token lists for the left side ("same" vs "deleted")
    and right side ("same" vs "inserted").
    """
    if left_text == right_text or re.sub(r"\s+", " ", left_text).strip() == re.sub(r"\s+", " ", right_text).strip():
        return (
            [DiffToken(op="same", text=left_text)],
            [DiffToken(op="same", text=right_text)],
            False,
        )

    left = tokenize_words(left_text)
    right = tokenize_words(right_text)

    import difflib
    matcher = difflib.SequenceMatcher(None, left, right)
    raw_left: list[DiffToken] = []
    raw_right: list[DiffToken] = []

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            raw_left.append(DiffToken(op="same", text="".join(left[i1:i2])))
            raw_right.append(DiffToken(op="same", text="".join(right[j1:j2])))
        elif tag == "delete":
            raw_left.append(DiffToken(op="deleted", text="".join(left[i1:i2])))
        elif tag == "insert":
            raw_right.append(DiffToken(op="inserted", text="".join(right[j1:j2])))
        elif tag == "replace":
            raw_left.append(DiffToken(op="deleted", text="".join(left[i1:i2])))
            raw_right.append(DiffToken(op="inserted", text="".join(right[j1:j2])))

    left_tokens = _cluster_edits(_merge_tokens(raw_left), "deleted")
    right_tokens = _cluster_edits(_merge_tokens(raw_right), "inserted")

    has_diff = any(t.op == "deleted" for t in left_tokens) or any(t.op == "inserted" for t in right_tokens)
    return left_tokens, right_tokens, has_diff
