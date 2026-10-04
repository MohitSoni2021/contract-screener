export type DiffOp = "same" | "deleted" | "inserted";

export interface DiffToken {
  op: DiffOp;
  text: string;
}

/**
 * Tokenizes text into words, whitespace, and punctuation tokens while preserving exact formatting.
 */
export function tokenizeWords(text: string): string[] {
  if (!text) return [];
  const tokens = text.match(/\S+|\s+/g) || [];
  return tokens;
}

/**
 * Computes precise word-level diff between two texts using recursive Longest Common Matching Block (SequenceMatcher).
 * Handles texts of any size instantly without arbitrary quadratic fallback cutoffs.
 */
export function diffWords(
  leftText: string,
  rightText: string
): {
  leftTokens: DiffToken[];
  rightTokens: DiffToken[];
  hasDifferences: boolean;
} {
  // Short-circuit: identical text or identical after normalizing whitespace
  if (
    leftText === rightText ||
    leftText.replace(/\s+/g, " ").trim() === rightText.replace(/\s+/g, " ").trim()
  ) {
    return {
      leftTokens: [{ op: "same", text: leftText }],
      rightTokens: [{ op: "same", text: rightText }],
      hasDifferences: false,
    };
  }

  const left = tokenizeWords(leftText);
  const right = tokenizeWords(rightText);

  // Common prefix optimization
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) {
    start++;
  }

  // Common suffix optimization
  let endLeft = left.length;
  let endRight = right.length;
  while (endLeft > start && endRight > start && left[endLeft - 1] === right[endRight - 1]) {
    endLeft--;
    endRight--;
  }

  const prefixTokens: DiffToken[] =
    start > 0 ? [{ op: "same", text: left.slice(0, start).join("") }] : [];
  const suffixTokens: DiffToken[] =
    endLeft < left.length ? [{ op: "same", text: left.slice(endLeft).join("") }] : [];

  const midLeft = left.slice(start, endLeft);
  const midRight = right.slice(start, endRight);

  // Recursive Longest Common Matching Substring block finder
  function matchBlock(a: string[], b: string[]): { left: DiffToken[]; right: DiffToken[] } {
    if (a.length === 0) {
      return { left: [], right: b.map((t) => ({ op: "inserted", text: t })) };
    }
    if (b.length === 0) {
      return { left: a.map((t) => ({ op: "deleted", text: t })), right: [] };
    }

    const bIndices = new Map<string, number[]>();
    for (let j = 0; j < b.length; j++) {
      const tok = b[j];
      let arr = bIndices.get(tok);
      if (!arr) {
        arr = [];
        bIndices.set(tok, arr);
      }
      arr.push(j);
    }

    let bestA = 0;
    let bestB = 0;
    let maxLen = 0;
    let lengths = new Map<number, number>();

    for (let i = 0; i < a.length; i++) {
      const nextLengths = new Map<number, number>();
      const occurrences = bIndices.get(a[i]);
      if (occurrences) {
        for (let idx = 0; idx < occurrences.length; idx++) {
          const j = occurrences[idx];
          const k = (lengths.get(j - 1) || 0) + 1;
          nextLengths.set(j, k);
          if (k > maxLen) {
            maxLen = k;
            bestA = i - k + 1;
            bestB = j - k + 1;
          }
        }
      }
      lengths = nextLengths;
    }

    if (maxLen === 0) {
      return {
        left: a.map((t) => ({ op: "deleted", text: t })),
        right: b.map((t) => ({ op: "inserted", text: t })),
      };
    }

    const leftPart = matchBlock(a.slice(0, bestA), b.slice(0, bestB));
    const commonBlock: DiffToken[] = [
      { op: "same", text: a.slice(bestA, bestA + maxLen).join("") },
    ];
    const rightPart = matchBlock(a.slice(bestA + maxLen), b.slice(bestB + maxLen));

    return {
      left: [...leftPart.left, ...commonBlock, ...rightPart.left],
      right: [...leftPart.right, ...commonBlock, ...rightPart.right],
    };
  }

  const midRes = matchBlock(midLeft, midRight);

  function mergeTokens(tokens: DiffToken[]): DiffToken[] {
    const merged: DiffToken[] = [];
    for (const t of tokens) {
      if (t.text.length === 0) continue;
      if (merged.length > 0 && merged[merged.length - 1].op === t.op) {
        merged[merged.length - 1].text += t.text;
      } else {
        merged.push({ ...t });
      }
    }
    return merged;
  }

  function clusterEdits(tokens: DiffToken[], targetOp: "deleted" | "inserted"): DiffToken[] {
    let result = [...tokens];
    let changed = true;
    while (changed) {
      changed = false;
      const nextTokens: DiffToken[] = [];
      for (let k = 0; k < result.length; k++) {
        if (
          result[k].op === targetOp &&
          k + 2 < result.length &&
          result[k + 1].op === "same" &&
          result[k + 1].text.trim() === "" &&
          result[k + 2].op === targetOp
        ) {
          nextTokens.push({
            op: targetOp,
            text: result[k].text + result[k + 1].text + result[k + 2].text,
          });
          k += 2;
          changed = true;
        } else {
          nextTokens.push(result[k]);
        }
      }
      result = mergeTokens(nextTokens);
    }
    return result;
  }

  const rawLeft = mergeTokens([...prefixTokens, ...midRes.left, ...suffixTokens]);
  const rawRight = mergeTokens([...prefixTokens, ...midRes.right, ...suffixTokens]);

  const leftTokens = clusterEdits(rawLeft, "deleted");
  const rightTokens = clusterEdits(rawRight, "inserted");

  const hasDifferences =
    leftTokens.some((t) => t.op === "deleted") || rightTokens.some((t) => t.op === "inserted");

  return {
    leftTokens,
    rightTokens,
    hasDifferences,
  };
}
