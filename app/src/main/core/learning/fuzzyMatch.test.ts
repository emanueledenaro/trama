import { describe, expect, it } from "vitest";
import { fuzzyFindAndReplace, formatNoMatchHint, IDENTICAL_STRINGS_ERROR } from "./fuzzyMatch";
import { SequenceMatcher } from "./sequenceMatcher";

describe("SequenceMatcher (difflib)", () => {
  it("matches Python ratios", () => {
    expect(new SequenceMatcher("abcd", "bcde").ratio()).toBeCloseTo(0.75);
    expect(new SequenceMatcher("", "").ratio()).toBe(1);
    expect(new SequenceMatcher("hello world", "hello there world").ratio()).toBeCloseTo(0.7857, 3);
  });

  it("returns opcodes that rebuild the target", () => {
    const a = "the quick brown fox";
    const b = "the slow brown dog";
    let rebuilt = "";
    for (const [tag, i1, i2, j1, j2] of new SequenceMatcher(a, b).getOpcodes()) rebuilt += tag === "equal" ? a.slice(i1, i2) : b.slice(j1, j2);
    expect(rebuilt).toBe(b);
  });
});

describe("fuzzyFindAndReplace (Hermes fuzzy_match)", () => {
  it("replaces an exact unique match", () => {
    const result = fuzzyFindAndReplace("alpha\nbeta\ngamma", "beta", "BETA");
    expect(result).toMatchObject({ content: "alpha\nBETA\ngamma", count: 1, strategy: "exact", error: null });
  });

  it("refuses empty, blank and identical strings", () => {
    expect(fuzzyFindAndReplace("x", "", "y").error).toContain("old_string is empty");
    expect(fuzzyFindAndReplace("x", "  ", "y").error).toContain("only whitespace");
    expect(fuzzyFindAndReplace("x", "x", "x").error).toBe(IDENTICAL_STRINGS_ERROR);
  });

  it("asks for context when several regions match", () => {
    const result = fuzzyFindAndReplace("word word", "word", "other");
    expect(result.error).toContain("Found 2 matches");
    expect(result.content).toBe("word word");
    expect(fuzzyFindAndReplace("word word", "word", "other", true).content).toBe("other other");
  });

  it("tolerates trimmed lines and keeps the file's indentation", () => {
    const content = "def f():\n    return 1\n";
    const result = fuzzyFindAndReplace(content, "return 1", "return 2");
    expect(result.content).toBe("def f():\n    return 2\n");
    const indented = fuzzyFindAndReplace("if x:\n        a = 1\n        b = 2\n", "  a = 1\n  b = 2", "  a = 3\n  b = 4");
    expect(indented.strategy).toBe("line_trimmed");
    expect(indented.content).toBe("if x:\n        a = 3\n        b = 4\n");
  });

  it("matches across typographic Unicode and keeps it in the file", () => {
    const content = "Use the “quick” path — always.";
    const result = fuzzyFindAndReplace(content, 'Use the "quick" path -- always.', 'Use the "fast" path -- always.');
    expect(result.strategy).toBe("unicode_normalized");
    expect(result.content).toBe("Use the “fast” path — always.");
  });

  it("detects escape drift", () => {
    const result = fuzzyFindAndReplace("it's here\n  more", "it\\'s here\n more", "it\\'s there\n more");
    expect(result.error).toContain("Escape-drift detected");
  });

  it("uses the similarity strategies only for one region", () => {
    const content = "start\nalpha beta gamma\nend\n";
    const result = fuzzyFindAndReplace(content, "start\nalpha beta gamm\nend", "start\nchanged\nend");
    expect(result.strategy).toBe("block_anchor");
    expect(result.content).toBe("start\nchanged\nend\n");
  });

  it("suggests the closest sections on a miss", () => {
    const content = "one\n\tconfig = true\nthree";
    const result = fuzzyFindAndReplace(content, "config = false", "config = maybe");
    expect(result.error).toBe("Could not find a match for old_string in the file");
    const hint = formatNoMatchHint(result.error, 0, "config = false", content);
    expect(hint).toContain("Did you mean one of these sections?");
    expect(hint).toContain("   2| \tconfig = true");
  });
});
