/**
 * The subset of Python's `difflib.SequenceMatcher` that Hermes' fuzzy patch relies on: `ratio()` and
 * `getOpcodes()` over strings, with the same junk heuristic (`autojunk`: in sequences of 200 or more
 * items, an item that appears in more than 1% of `b` plus one is ignored when finding matches).
 */
type Opcode = ["equal" | "replace" | "delete" | "insert", number, number, number, number];

export class SequenceMatcher {
  private readonly b2j = new Map<string, number[]>();
  private matchingBlocks: [number, number, number][] | null = null;

  constructor(
    private readonly a: string,
    private readonly b: string,
  ) {
    const bChars = b.split("");
    bChars.forEach((char, index) => {
      const list = this.b2j.get(char);
      if (list) list.push(index);
      else this.b2j.set(char, [index]);
    });
    const n = bChars.length;
    if (n >= 200) {
      const popular = Math.floor(n / 100) + 1;
      for (const [char, indexes] of [...this.b2j]) if (indexes.length > popular) this.b2j.delete(char);
    }
    this.aChars = a.split("");
    this.bChars = bChars;
  }

  private readonly aChars: string[];
  private readonly bChars: string[];

  private findLongestMatch(alo: number, ahi: number, blo: number, bhi: number): [number, number, number] {
    let bestI = alo;
    let bestJ = blo;
    let bestSize = 0;
    let lengths = new Map<number, number>();
    for (let i = alo; i < ahi; i += 1) {
      const next = new Map<number, number>();
      for (const j of this.b2j.get(this.aChars[i]!) ?? []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (lengths.get(j - 1) ?? 0) + 1;
        next.set(j, k);
        if (k > bestSize) {
          bestI = i - k + 1;
          bestJ = j - k + 1;
          bestSize = k;
        }
      }
      lengths = next;
    }
    // Extend over equal items on both sides: this recovers matches through popular items (difflib has no explicit junk here).
    while (bestI > alo && bestJ > blo && this.aChars[bestI - 1] === this.bChars[bestJ - 1]) {
      bestI -= 1;
      bestJ -= 1;
      bestSize += 1;
    }
    while (bestI + bestSize < ahi && bestJ + bestSize < bhi && this.aChars[bestI + bestSize] === this.bChars[bestJ + bestSize]) {
      bestSize += 1;
    }
    return [bestI, bestJ, bestSize];
  }

  getMatchingBlocks(): [number, number, number][] {
    if (this.matchingBlocks) return this.matchingBlocks;
    const la = this.aChars.length;
    const lb = this.bChars.length;
    const queue: [number, number, number, number][] = [[0, la, 0, lb]];
    const blocks: [number, number, number][] = [];
    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop()!;
      const [i, j, k] = this.findLongestMatch(alo, ahi, blo, bhi);
      if (k) {
        blocks.push([i, j, k]);
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
      }
    }
    blocks.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
    const merged: [number, number, number][] = [];
    let [i1, j1, k1] = [0, 0, 0];
    for (const [i2, j2, k2] of blocks) {
      if (i1 + k1 === i2 && j1 + k1 === j2) k1 += k2;
      else {
        if (k1) merged.push([i1, j1, k1]);
        [i1, j1, k1] = [i2, j2, k2];
      }
    }
    if (k1) merged.push([i1, j1, k1]);
    merged.push([la, lb, 0]);
    this.matchingBlocks = merged;
    return merged;
  }

  ratio(): number {
    const matches = this.getMatchingBlocks().reduce((sum, block) => sum + block[2], 0);
    const total = this.aChars.length + this.bChars.length;
    return total ? (2 * matches) / total : 1;
  }

  /** Opcodes over UTF-16 indexes of `a` and `b`, so they slice JavaScript strings directly. */
  getOpcodes(): Opcode[] {
    let i = 0;
    let j = 0;
    const result: Opcode[] = [];
    for (const [ai, bj, size] of this.getMatchingBlocks()) {
      const tag = i < ai && j < bj ? "replace" : i < ai ? "delete" : j < bj ? "insert" : null;
      if (tag) result.push([tag, i, ai, j, bj]);
      i = ai + size;
      j = bj + size;
      if (size) result.push(["equal", ai, i, bj, j]);
    }
    return result;
  }
}

export const similarity = (a: string, b: string) => new SequenceMatcher(a, b).ratio();
