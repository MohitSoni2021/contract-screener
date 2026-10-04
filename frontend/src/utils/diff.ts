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
  // Match sequences of word chars, or sequences of non-word/whitespace chars, or whitespace
  const tokens = text.match(/\S+|\s+/g) || [];
  return tokens;
}

/**
 * Computes word-level diff between two texts using an optimized Longest Common Subsequence (LCS).
 * Returns separate token arrays for the left side (marking "same" vs "deleted")
 * and right side (marking "same" vs "inserted").
 */
export function diffWords(
  leftText: string,
  rightText: string
): {
  leftTokens: DiffToken[];
  rightTokens: DiffToken[];
  hasDifferences: boolean;
} {
  const left = tokenizeWords(leftText);
  const right = tokenizeWords(rightText);

  const n = left.length;
  const m = right.length;

  // Short-circuit: identical text
  if (leftText === rightText) {
    return {
      leftTokens: [{ op: "same", text: leftText }],
      rightTokens: [{ op: "same", text: rightText }],
      hasDifferences: false,
    };
  }

  // Optimize for large texts: find common prefix and suffix
  let prefixCount = 0;
  while (prefixCount < n && prefixCount < m && left[prefixCount] === right[prefixCount]) {
    prefixCount++;
  }

  let suffixCount = 0;
  while (
    suffixCount < n - prefixCount &&
    suffixCount < m - prefixCount &&
    left[n - 1 - suffixCount] === right[m - 1 - suffixCount]
  ) {
    suffixCount++;
  }

  const midLeft = left.slice(prefixCount, n - suffixCount);
  const midRight = right.slice(prefixCount, m - suffixCount);

  // If midLeft or midRight is huge (> 1000 tokens), avoid full O(N*M) table by using a greedy or chunked LCS
  const midN = midLeft.length;
  const midM = midRight.length;

  let midLcsLeft: DiffToken[] = [];
  let midLcsRight: DiffToken[] = [];

  if (midN === 0) {
    // Pure insertion
    midLcsRight = midRight.map((t) => ({ op: "inserted", text: t }));
  } else if (midM === 0) {
    // Pure deletion
    midLcsLeft = midLeft.map((t) => ({ op: "deleted", text: t }));
  } else if (midN * midM <= 250000) {
    // Standard Dynamic Programming LCS table
    const dp: number[][] = Array.from({ length: midN + 1 }, () => new Array(midM + 1).fill(0));

    for (let i = 1; i <= midN; i++) {
      for (let j = 1; j <= midM; j++) {
        if (midLeft[i - 1] === midRight[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
        }
      }
    }

    // Backtrack to reconstruct alignment
    let i = midN;
    let j = midM;
    const revLeft: DiffToken[] = [];
    const revRight: DiffToken[] = [];

    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && midLeft[i - 1] === midRight[j - 1]) {
        revLeft.push({ op: "same", text: midLeft[i - 1] });
        revRight.push({ op: "same", text: midRight[j - 1] });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        revRight.push({ op: "inserted", text: midRight[j - 1] });
        j--;
      } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
        revLeft.push({ op: "deleted", text: midLeft[i - 1] });
        i--;
      }
    }

    midLcsLeft = revLeft.reverse();
    midLcsRight = revRight.reverse();
  } else {
    // Fallback for massive paragraphs: treat entire middle as changed
    midLcsLeft = midLeft.map((t) => ({ op: "deleted", text: t }));
    midLcsRight = midRight.map((t) => ({ op: "inserted", text: t }));
  }

  // Combine prefix + middle + suffix
  const prefixTokens: DiffToken[] = prefixCount > 0 ? [{ op: "same", text: left.slice(0, prefixCount).join("") }] : [];
  const suffixTokens: DiffToken[] = suffixCount > 0 ? [{ op: "same", text: left.slice(n - suffixCount).join("") }] : [];

  // Merge adjacent tokens with same op for optimal DOM rendering
  function mergeTokens(tokens: DiffToken[]): DiffToken[] {
    const merged: DiffToken[] = [];
    for (const t of tokens) {
      if (merged.length > 0 && merged[merged.length - 1].op === t.op) {
        merged[merged.length - 1].text += t.text;
      } else {
        merged.push({ ...t });
      }
    }
    return merged;
  }

  // Cluster edits separated only by whitespace (e.g. "thirty-day" + " " + "(30-day)")
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

  const rawLeft = mergeTokens([...prefixTokens, ...midLcsLeft, ...suffixTokens]);
  const rawRight = mergeTokens([...prefixTokens, ...midLcsRight, ...suffixTokens]);

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
