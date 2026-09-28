import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "index.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of every rule whose selector list is exactly `selector`. */
const rules = (selector: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1]!.split(",").some((s) => s.trim() === selector)).map((m) => m[2]!);

describe("glass surfaces (issue #392)", () => {
  it("keeps each blur layer behind its own surface, not behind the chat", () => {
    // A `::before` at z-index -1 with a backdrop blur is the glass of its surface. Without its own stacking context the
    // layer falls behind the timeline and the chat reads through the surface, as the Aspetta te strip above the composer did.
    const layers = [...css.matchAll(/([^{}]+)::before\s*\{([^{}]*)\}/g)].filter((m) => /z-index:\s*-1/.test(m[2]!) && /backdrop-filter/.test(m[2]!));
    const surfaces = layers.map((m) => m[1]!.trim());
    expect(surfaces).toEqual(expect.arrayContaining([".chat-composer-surface", ".translucent-popup"]));
    for (const surface of surfaces) {
      expect(
        rules(surface).some((body) => /isolation:\s*isolate/.test(body) || /@apply[^;]*\bisolate\b/.test(body)),
        surface,
      ).toBe(true);
    }
  });
});
