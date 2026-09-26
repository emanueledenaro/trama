import { describe, expect, it } from "vitest";
// @ts-expect-error The script is plain JavaScript without type declarations.
import { caseCollisions } from "./check-file-names.mjs";

describe("caseCollisions", () => {
  it("finds modules an import without extension cannot tell apart", () => {
    expect(caseCollisions(["a/TramaMark.tsx", "a/tramaMark.ts", "a/tramaMarkPalette.ts"])).toEqual([["a/TramaMark.tsx", "a/tramaMark.ts"]]);
  });

  it("finds whole paths that differ only by case", () => {
    expect(caseCollisions(["docs/Readme.md", "docs/README.md"])).toEqual([["docs/README.md", "docs/Readme.md"]]);
  });

  it("accepts a module and its test, and the same name in other folders", () => {
    expect(caseCollisions(["a/Mark.tsx", "a/Mark.test.ts", "b/mark.ts", "a/mark.css"])).toEqual([]);
  });
});
