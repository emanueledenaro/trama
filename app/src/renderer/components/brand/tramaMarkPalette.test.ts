import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND_COLORS, PROVIDER_COLORS, SMALL_MARK_MAX, tramaMarkColors, usesSmallGlyph } from "./tramaMarkPalette";
import { GLYPH_PATH, SMALL_GLYPH_PATH } from "./tramaMarkGeometry";

const repo = resolve(import.meta.dirname, "../../../../..");
const read = (path: string) => readFileSync(resolve(repo, path), "utf8");

describe("TramaMark", () => {
  it("draws the simplified glyph up to 32 px", () => {
    expect(SMALL_MARK_MAX).toBe(32);
    expect([16, 24, 32].every(usesSmallGlyph)).toBe(true);
    expect([33, 40, 44, 64].some(usesSmallGlyph)).toBe(false);
  });

  it("uses the brand colors documented in docs/brand/README.md", () => {
    const doc = read("docs/brand/README.md");
    const hexes = [...BRAND_COLORS.face, ...BRAND_COLORS.back, BRAND_COLORS.shade, ...BRAND_COLORS.tile, ...BRAND_COLORS.tileLights, BRAND_COLORS.tileShade];
    for (const hex of hexes) expect(doc).toContain(`\`${hex}\``);
    expect(tramaMarkColors("brand")).toBe(BRAND_COLORS);
  });

  it("takes the provider colors from tokens that index.css defines for every theme", () => {
    const css = read("app/src/renderer/index.css");
    const colors = tramaMarkColors("provider");
    expect(colors).toBe(PROVIDER_COLORS);
    const tokens = new Set(
      [...colors.face, ...colors.back, colors.shade, ...colors.tile, ...colors.tileLights, colors.tileShade].map((value) => value.match(/^var\((--[a-z-]+)\)$/)?.[1]),
    );
    expect(tokens.has(undefined)).toBe(false);
    // Each token comes from the provider's accent, directly or through another mark token.
    for (const token of tokens) expect(css).toMatch(new RegExp(`${token}:\\s*[^;]*var\\(--(color-text-accent|trama-mark-[a-z]+)\\)`));
  });

  it("draws the same glyph as the SVG files in docs/brand", () => {
    expect(read("docs/brand/trama-glyph-mono.svg")).toContain(`d="${GLYPH_PATH}"`);
    expect(read("docs/brand/trama-glyph-small.svg")).toContain(`d="${SMALL_GLYPH_PATH}"`);
  });
});
