import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "index.css"), "utf8");

/** The provider theme blocks of index.css, by selector. */
const providerBlocks = () => [...css.matchAll(/(:root(?:\.dark)?\[data-provider="([a-zA-Z]+)"\])\s*\{([^}]*)\}/g)].map((match) => ({ selector: match[1]!, provider: match[2]!, body: match[3]! }));
const declared = (body: string) => [...body.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]!);
const rootBlock = (selector: string) => {
  const start = css.indexOf(`\n${selector} {`);
  return start < 0 ? "" : css.slice(css.indexOf("{", start) + 1, css.indexOf("}", start));
};
const hex = (body: string, token: string) => body.match(new RegExp(`${token}:\\s*(#[0-9a-f]{6});`, "i"))?.[1]?.toLowerCase();

// Issue #457: one neutral glass surface for every provider; the provider sets only the accents.
const ACCENTS = ["--provider-light", "--color-text-accent", "--primary", "--primary-foreground", "--ring", "--app-user-message-background", "--sidebar-selected"];

describe("provider themes (issue #457)", () => {
  it("have a light and a dark block for each of the nine providers", () => {
    const blocks = providerBlocks();
    expect(new Set(blocks.map((block) => block.provider)).size).toBe(9);
    expect(blocks.filter((block) => block.selector.includes(".dark"))).toHaveLength(9);
  });

  it("set only the accents, never the surface, the ink, the glass light, the section tints or the status colors", () => {
    for (const block of providerBlocks()) expect(declared(block.body), block.selector).toEqual(ACCENTS);
  });

  it("keep the surface white in light and dark in dark, with the section tints a step apart from each other", () => {
    for (const [selector, surface] of [
      [":root", "#ffffff"],
      [":root.dark", "#212121"],
    ] as const) {
      const body = rootBlock(selector);
      expect(hex(body, "--surface"), selector).toBe(surface);
      const tints = ["editor", "panel", "sidebar", "activitybar", "statusbar"].map((section) => hex(body, `--app-${section}-tint`));
      expect(tints[0], selector).toBe(surface);
      expect(tints.every(Boolean), selector).toBe(true);
      expect(new Set(tints).size, selector).toBe(tints.length);
      // Slightly different: each tint stays within a small step of the editor.
      for (const tint of tints) expect(Math.abs(parseInt(tint!.slice(1, 3), 16) - parseInt(surface.slice(1, 3), 16)), `${selector} ${tint}`).toBeLessThanOrEqual(20);
    }
  });

  it("color the lit sash with the provider's accent and the glass veil with the neutral light", () => {
    expect(hex(rootBlock(":root"), "--glass-light")).toBeDefined();
    expect(hex(rootBlock(":root.dark"), "--glass-light")).toBeDefined();
    expect(rootBlock(":root")).toMatch(/--app-focus-border:\s*var\(--color-text-accent\);/);
    expect(css).not.toMatch(/--glow-1/);
    const veils = [...css.matchAll(/:root(?:\.dark)?\[data-platform="win32"\] body \{([^}]*)\}/g)].map((match) => match[1]!);
    expect(veils).toHaveLength(2);
    for (const veil of veils) expect(veil).toMatch(/background: color-mix\(in srgb, var\(--glass-light\) \d+%, transparent\) !important;/);
  });
});
