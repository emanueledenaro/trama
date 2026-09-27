import { describe, expect, it } from "vitest";
// @ts-expect-error The script is plain JavaScript without type declarations.
import { findUpstreamNames, isLegalPath, parseNames } from "./check-upstream-names.mjs";

describe("findUpstreamNames", () => {
  const names = ["upstreamone", "upstreamtwo"];

  it("reports the lines that name a project, ignoring case", () => {
    const files = [{ path: "app/src/a.ts", text: "const a = 1;\n// Ported from UpstreamOne\nconst b = 2;\n// UPSTREAMTWO too" }];
    expect(findUpstreamNames(files, names)).toEqual([{ path: "app/src/a.ts", inPath: false, lines: [2, 4] }]);
  });

  it("reports a name in the path, also for binary files", () => {
    expect(findUpstreamNames([{ path: "docs/upstreamone-notes.md", text: null }], names)).toEqual([
      { path: "docs/upstreamone-notes.md", inPath: true, lines: [] },
    ]);
  });

  it("accepts the legal attribution files and clean files", () => {
    const files = [
      { path: "THIRD_PARTY_NOTICES.md", text: "UpstreamOne, MIT" },
      { path: "docs/legal/upstreamone-attribution.md", text: "UpstreamOne" },
      { path: "README.md", text: "Trama" },
    ];
    expect(findUpstreamNames(files, names)).toEqual([]);
  });
});

describe("isLegalPath", () => {
  it("allows only the notices file and docs/legal", () => {
    expect(isLegalPath("THIRD_PARTY_NOTICES.md")).toBe(true);
    expect(isLegalPath("docs/legal/x-LICENSE")).toBe(true);
    expect(isLegalPath("docs/THIRD_PARTY_NOTICES.md")).toBe(false);
    expect(isLegalPath("docs/legally.md")).toBe(false);
  });
});

describe("parseNames", () => {
  it("skips comments and blank lines and lowercases the names", () => {
    expect(parseNames("# names\n\nUpstreamOne\n  upstreamtwo  \n")).toEqual(["upstreamone", "upstreamtwo"]);
  });
});
