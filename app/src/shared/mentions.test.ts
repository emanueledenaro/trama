import { describe, expect, it } from "vitest";
import { fileScore, mentionCandidates, mentionContextBlock, mentionPaths, mentionToken, resolveMentions } from "./mentions";

const sources = {
  modules: [
    {
      id: "Sources/Orders",
      name: "Orders",
      summary: "2 file",
      relativePath: "Sources/Orders",
      files: [{ id: "Sources/Orders/CancelPaidOrder.swift", relativePath: "Sources/Orders/CancelPaidOrder.swift", lineCount: 15, contentHash: "" }],
      dependencies: ["Payments"],
      symbol: "folder",
    },
  ],
  issues: [{ number: 12, title: "Annullo ordini", state: "open" as const, body: "Testo", url: "https://github.com/o/r/issues/12", author: null, labels: ["bug"], updatedAt: "" }],
  decisions: [{ id: "D-1", value: "Revisione", acceptedExample: "Ordine 42", rationale: "r", version: 2, decidedAt: "" }],
};

describe("composer mentions", () => {
  it("writes and reads tokens, quoting when needed", () => {
    expect(mentionToken({ kind: "module", key: "Sources/Orders" })).toBe("@module:Sources/Orders");
    expect(mentionToken({ kind: "file", key: "My File.swift" })).toBe('@"My File.swift"');
    expect(mentionPaths('Guarda @"My File.swift" e @issue:12.')).toEqual(["My File.swift", "issue:12."]);
  });

  it("resolves only real objects and builds the context block", () => {
    const text = "Vedi @module:Sources/Orders, @issue:12 @decision:d-1 @Sources/Orders/CancelPaidOrder.swift @nulla";
    expect(resolveMentions(text, sources).map((m) => m.label)).toEqual([
      "modulo Orders",
      "issue #12",
      "decisione D-1",
      "file Sources/Orders/CancelPaidOrder.swift",
    ]);
    const block = mentionContextBlock(text, sources)!;
    expect(block).toContain("<mentioned_context>");
    expect(block).toContain("Decision D-1 v2: Revisione");
    expect(mentionContextBlock("nessuna menzione", sources)).toBeNull();
  });

  it("ranks candidates like Synara", () => {
    expect(fileScore("Sources/Orders/CancelPaidOrder.swift", "cancel")).toBe(2);
    expect(fileScore("Sources/Orders/CancelPaidOrder.swift", "cpo")).toBeGreaterThan(100);
    expect(mentionCandidates("ord", sources)[0]!.title).toBe("Orders");
    expect(mentionCandidates("issue:12", sources).map((c) => c.title)).toEqual(["#12 Annullo ordini"]);
  });
});
