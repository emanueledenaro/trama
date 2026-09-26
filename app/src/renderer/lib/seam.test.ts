import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mountSeam, SEAM_PRIORITY, shownSeam, visibleSeam } from "./seam";

const css = readFileSync(join(__dirname, "..", "index.css"), "utf8");
const token = (name: string) => css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim();

describe("the seam (W17)", () => {
  it("shows at most one seam: the use with the highest priority, the first mounted on a tie", () => {
    expect(visibleSeam([])).toBeNull();
    expect(
      visibleSeam([
        { id: "goal", use: "firstGoal", order: 0 },
        { id: "focus", use: "focus", order: 1 },
      ]),
    ).toBe("focus");
    expect(
      visibleSeam([
        { id: "focus", use: "focus", order: 2 },
        { id: "drop", use: "fileDrop", order: 3 },
        { id: "goal", use: "firstGoal", order: 1 },
      ]),
    ).toBe("drop");
    expect(
      visibleSeam([
        { id: "second", use: "firstGoal", order: 5 },
        { id: "first", use: "firstGoal", order: 4 },
      ]),
    ).toBe("first");
  });

  it("gives the seam back to the next use when the one showing it goes away", () => {
    const unmountGoal = mountSeam("goal", "firstGoal");
    expect(shownSeam()).toBe("goal");
    const unmountDrop = mountSeam("drop", "fileDrop");
    expect(shownSeam()).toBe("drop");
    unmountDrop();
    expect(shownSeam()).toBe("goal");
    unmountGoal();
    expect(shownSeam()).toBeNull();
  });

  it("keeps the approved uses to between three and five", () => {
    const uses = Object.keys(SEAM_PRIORITY);
    expect(uses.length).toBeGreaterThanOrEqual(3);
    expect(uses.length).toBeLessThanOrEqual(5);
    expect(new Set(Object.values(SEAM_PRIORITY)).size).toBe(uses.length);
  });

  it("draws the bots' stitch: the same dash, gap and width, scaled to a bot at its largest size", () => {
    expect(token("bot-seam-width")).toBe("3.5");
    expect(token("bot-seam-dash")).toBe("7");
    expect(token("bot-seam-gap")).toBe("8");
    expect(token("seam-scale")).toBe("calc(96 / 216)");
    expect(token("seam-width")).toBe("calc(var(--bot-seam-width) * var(--seam-scale) * 1px)");
    expect(token("seam-dash")).toBe("calc(var(--bot-seam-dash) * var(--seam-scale) * 1px)");
    expect(token("seam-gap")).toBe("calc(var(--bot-seam-gap) * var(--seam-scale) * 1px)");
  });

  it("becomes a continuous edge with high contrast and forced colors", () => {
    for (const media of ["@media (prefers-contrast: more)", "@media (forced-colors: active)"]) {
      const block = css.slice(css.indexOf(media), css.indexOf("}\n}", css.indexOf(media)));
      expect(block).toContain(".seam-stitch rect");
      expect(block).toContain("stroke-dasharray: none");
    }
  });
});
