import { describe, expect, it } from "vitest";
import {
  colleagueMessage,
  compareSides,
  conflictRanges,
  coordinatorNotice,
  linesLabel,
  mapMarks,
  type OverlapModule,
  overlapSummary,
  type PresenceProbe,
} from "./overlap";
import type { PresenceEntry, PresenceRecord } from "./presence";

const now = "2026-09-26T10:00:00.000Z";

function entry(user: string, name: string, files: string[], extra: Partial<PresenceRecord> = {}): PresenceEntry {
  return {
    record: {
      version: 1,
      user,
      name,
      activeBranch: `feature/${user}`,
      alsoOn: [],
      localBranches: [],
      files,
      task: { kind: "goal", title: "Rimborsi parziali" },
      since: now,
      lastActivityAt: now,
      updatedAt: now,
      closedAt: null,
      agents: [],
      ...extra,
    },
    self: false,
    status: "active",
    idleMinutes: null,
    lastSeenAt: null,
  };
}

const modules: OverlapModule[] = [
  { id: "m-pay", name: "Pagamenti", relativePath: "src/payments", files: ["src/payments/pay.ts", "src/payments/refund.ts"] },
  { id: "m-cart", name: "Carrello", relativePath: "src/cart", files: ["src/cart/cart.ts"] },
];

const compare = (files: string[], others: PresenceEntry[], probes: PresenceProbe[] = [], moduleIds: string[] = []) =>
  compareSides({ sides: [{ mine: null, files, moduleIds }], others, modules, probes, pullRequests: [] });

describe("overlap levels (decision 3)", () => {
  it("tells the same module, the same file and a confirmed conflict apart", () => {
    const bea = entry("bea", "Bea", ["src/payments/refund.ts"]);
    expect(compare(["src/payments/pay.ts"], [bea]).map((i) => i.level)).toEqual(["module"]);
    expect(compare(["src/payments/refund.ts"], [bea]).map((i) => i.level)).toEqual(["file"]);
    const probe: PresenceProbe = {
      user: "bea",
      branch: "feature/bea",
      mine: null,
      remoteSHA: "a".repeat(40),
      snapshotId: "s",
      status: "conflict",
      files: ["src/payments/refund.ts"],
      lines: { "src/payments/refund.ts": [{ start: 3, end: 5 }] },
      checkedAt: now,
    };
    const [conflict] = compare(["src/payments/refund.ts"], [bea], [probe]);
    expect(conflict!.level).toBe("conflict");
    expect(overlapSummary(conflict!)).toBe("Conflitto con Bea in src/payments/refund.ts (righe 3-5).");
    // A clean probe leaves the file level.
    expect(compare(["src/payments/refund.ts"], [bea], [{ ...probe, status: "clean" }])[0]!.level).toBe("file");
    expect(compare(["src/cart/cart.ts"], [bea])).toEqual([]);
  });

  it("compares a task that has not started by the modules of its plan", () => {
    const bea = entry("bea", "Bea", ["src/payments/refund.ts"]);
    const [item] = compare([], [bea], [], ["m-pay"]);
    expect(item!.level).toBe("module");
    expect(overlapSummary(item!)).toBe("Bea lavora anche nel modulo Pagamenti.");
  });

  it("compares with the colleagues' agents apart, and leaves out the person and expired records", () => {
    const bea = entry("bea", "Bea", [], {
      agents: [{ id: "a1", name: "Pixel", color: "blue", tag: "Interfaccia", branch: "trama/pixel", files: ["src/cart/cart.ts"], task: null, since: now, lastActivityAt: now }],
    });
    const [item] = compare(["src/cart/cart.ts"], [bea]);
    expect(item!.colleague.agent?.name).toBe("Pixel");
    expect(overlapSummary(item!)).toBe("Pixel, agente di Bea tocca anche src/cart/cart.ts.");
    expect(compare(["src/cart/cart.ts"], [{ ...bea, self: true }])).toEqual([]);
    expect(compare(["src/cart/cart.ts"], [{ ...bea, status: "expired" }])).toEqual([]);
  });

  it("finds the colleague's open pull request on the same branch", () => {
    const bea = entry("bea", "Bea", ["src/payments/pay.ts"]);
    const [item] = compareSides({
      sides: [{ mine: null, files: ["src/payments/pay.ts"], moduleIds: [] }],
      others: [bea],
      modules,
      probes: [],
      pullRequests: [
        { number: 7, url: "https://github.com/o/r/pull/7", headRef: "feature/other", author: "bea" },
        { number: 9, url: "https://github.com/o/r/pull/9", headRef: "feature/bea", author: "bea" },
      ],
    });
    expect(item!.pullRequest).toEqual({ number: 9, url: "https://github.com/o/r/pull/9" });
    expect(coordinatorNotice(item!, "working").text).toContain("pull request #9");
  });
});

describe("map marks", () => {
  it("marks what others touch and raises it to the overlap with the person", () => {
    const bea = entry("bea", "Bea", ["src/payments/refund.ts", "src/cart/cart.ts"]);
    const items = compare(["src/payments/refund.ts"], [bea]);
    const marks = mapMarks([bea], modules, items);
    expect(marks.files["src/payments/refund.ts"]).toEqual({ level: "file", people: ["Bea"] });
    expect(marks.files["src/cart/cart.ts"]).toEqual({ level: "touched", people: ["Bea"] });
    expect(marks.modules["m-pay"]!.level).toBe("file");
    expect(marks.modules["m-cart"]!.level).toBe("touched");
  });
});

describe("message to the colleague (decision 10)", () => {
  it("names the files, the branches and the lines, and asks to talk", () => {
    const bea = entry("bea", "Bea Rossi", ["src/payments/refund.ts"]);
    const probe: PresenceProbe = {
      user: "bea",
      branch: "feature/bea",
      mine: null,
      remoteSHA: "a".repeat(40),
      snapshotId: "s",
      status: "conflict",
      files: ["src/payments/refund.ts"],
      lines: { "src/payments/refund.ts": [{ start: 2, end: 2 }] },
      checkedAt: now,
    };
    const [item] = compare(["src/payments/refund.ts"], [bea], [probe]);
    const text = colleagueMessage(item!, { name: "Ada", branch: "feature/carrello" });
    expect(text).toContain("Ciao Bea, sono Ada.");
    expect(text).toContain("src/payments/refund.ts");
    expect(text).toContain("Io sono su feature/carrello, tu sei su feature/bea (\"Rimborsi parziali\").");
    expect(text).toContain("dà conflitto in src/payments/refund.ts (riga 2)");
    expect(text).not.toMatch(/[–—]/);
  });
});

describe("conflict lines", () => {
  it("reads the person's side of each conflict block", () => {
    const merged = ["uno", "<<<<<<< ours", "DUE mio", "altro mio", "=======", "due suo", ">>>>>>> theirs", "tre", "<<<<<<< ours", "=======", "via", ">>>>>>> theirs", ""].join("\n");
    expect(conflictRanges(merged)).toEqual([
      { start: 2, end: 3 },
      // An empty side on the person's part names the line where the other side would go.
      { start: 5, end: 5 },
    ]);
    expect(conflictRanges("a\n<<<<<<< a\nx\n||||||| base\ny\n=======\nz\n>>>>>>> b\n")).toEqual([{ start: 2, end: 2 }]);
    expect(linesLabel([{ start: 2, end: 3 }, { start: 9, end: 9 }])).toBe("righe 2-3 e 9");
    expect(linesLabel([{ start: 4, end: 4 }])).toBe("riga 4");
  });
});
