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
    """Computes word-level diff between two texts using an optimized Longest Common Subsequence (LCS).
    Returns separate token lists for the left side ("same" vs "deleted")
    and right side ("same" vs "inserted").
    """
    if left_text == right_text:
        return (
            [DiffToken(op="same", text=left_text)],
            [DiffToken(op="same", text=right_text)],
            False,
        )

    left = tokenize_words(left_text)
    right = tokenize_words(right_text)
    n = len(left)
    m = len(right)

    prefix_count = 0
    while prefix_count < n and prefix_count < m and left[prefix_count] == right[prefix_count]:
        prefix_count += 1

    suffix_count = 0
    while (
        suffix_count < n - prefix_count
        and suffix_count < m - prefix_count
        and left[n - 1 - suffix_count] == right[m - 1 - suffix_count]
    ):
        suffix_count += 1

    mid_left = left[prefix_count : n - suffix_count]
    mid_right = right[prefix_count : m - suffix_count]
    mid_n = len(mid_left)
    mid_m = len(mid_right)

    if mid_n == 0:
        mid_lcs_left: list[DiffToken] = []
        mid_lcs_right = [DiffToken(op="inserted", text=t) for t in mid_right]
    elif mid_m == 0:
        mid_lcs_left = [DiffToken(op="deleted", text=t) for t in mid_left]
        mid_lcs_right = []
    elif mid_n * mid_m <= 250000:
        dp = [[0] * (mid_m + 1) for _ in range(mid_n + 1)]
        for i in range(1, mid_n + 1):
            for j in range(1, mid_m + 1):
                if mid_left[i - 1] == mid_right[j - 1]:
                    dp[i][j] = dp[i - 1][j - 1] + 1
                else:
                    dp[i][j] = max(dp[i - 1][j], dp[i][j - 1])

        i, j = mid_n, mid_m
        rev_left: list[DiffToken] = []
        rev_right: list[DiffToken] = []

        while i > 0 or j > 0:
            if i > 0 and j > 0 and mid_left[i - 1] == mid_right[j - 1]:
                rev_left.append(DiffToken(op="same", text=mid_left[i - 1]))
                rev_right.append(DiffToken(op="same", text=mid_right[j - 1]))
                i -= 1
                j -= 1
            elif j > 0 and (i == 0 or dp[i][j - 1] >= dp[i - 1][j]):
                rev_right.append(DiffToken(op="inserted", text=mid_right[j - 1]))
                j -= 1
            elif i > 0 and (j == 0 or dp[i][j - 1] < dp[i - 1][j]):
                rev_left.append(DiffToken(op="deleted", text=mid_left[i - 1]))
                i -= 1

        rev_left.reverse()
        rev_right.reverse()
        mid_lcs_left = rev_left
        mid_lcs_right = rev_right
    else:
        mid_lcs_left = [DiffToken(op="deleted", text=t) for t in mid_left]
        mid_lcs_right = [DiffToken(op="inserted", text=t) for t in mid_right]

    prefix_tokens = [DiffToken(op="same", text="".join(left[:prefix_count]))] if prefix_count > 0 else []
    suffix_tokens = [DiffToken(op="same", text="".join(left[n - suffix_count :]))] if suffix_count > 0 else []

    raw_left = _merge_tokens(prefix_tokens + mid_lcs_left + suffix_tokens)
    raw_right = _merge_tokens(prefix_tokens + mid_lcs_right + suffix_tokens)

    left_tokens = _cluster_edits(raw_left, "deleted")
    right_tokens = _cluster_edits(raw_right, "inserted")

    has_diff = any(t.op == "deleted" for t in left_tokens) or any(t.op == "inserted" for t in right_tokens)
    return left_tokens, right_tokens, has_diff
