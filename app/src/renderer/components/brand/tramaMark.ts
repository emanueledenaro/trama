/** Colors and sizes of Trama's mark (B01). The shapes are in tramaMarkGeometry.ts; docs/brand/README.md explains the brand. */

export type TramaMarkVariant = "glyph" | "tile" | "mono";
/** "provider" takes the accent of the provider theme in use (index.css); "brand" uses the fixed colors of the app icon. */
export type TramaMarkPalette = "provider" | "brand";

/** Up to this size in CSS pixels the mark uses the simplified glyph: no gaps, no hairline, thicker ribbons. */
export const SMALL_MARK_MAX = 32;

export function usesSmallGlyph(size: number): boolean {
  return size <= SMALL_MARK_MAX;
}

export interface TramaMarkColors {
  /** The ribbons' face, along the gradient from the lower left to the upper right. */
  face: readonly [string, string, string, string];
  /** The ribbons' back side, seen in the gaps and in the lens-shaped holes, top to bottom. */
  back: readonly [string, string];
  /** Shadow where a ribbon passes under another one, and its strongest opacity. */
  shade: string;
  shadeOpacity: number;
  /** The tile: lower left, middle, upper right, and the light in the upper right corner. */
  tile: readonly [string, string, string, string];
  /** Softer lights in the tile's upper left and lower right corners. */
  tileLights: readonly [string, string];
  /** Shadow on the white glyph over the tile. */
  tileShade: string;
  tileShadeOpacity: number;
}

/** The brand palette, sampled from docs/brand/source and written in docs/brand/README.md. */
export const BRAND_COLORS: TramaMarkColors = {
  face: ["#3558FB", "#5A6BFC", "#8F86FA", "#CDAAFB"],
  back: ["#1A2BC4", "#040F63"],
  shade: "#010E6E",
  shadeOpacity: 0.82,
  tile: ["#08157A", "#2333D6", "#6C4DF9", "#D6B8FF"],
  tileLights: ["#3D55F5", "#3A55FF"],
  tileShade: "#1F33D6",
  tileShadeOpacity: 0.62,
};

/** The provider's accent and light, from the tokens in index.css; they change with data-provider and the dark class. */
export const PROVIDER_COLORS: TramaMarkColors = {
  face: ["var(--trama-mark-from)", "var(--trama-mark-from)", "var(--trama-mark-mid)", "var(--trama-mark-to)"],
  back: ["var(--trama-mark-back)", "var(--trama-mark-deep)"],
  shade: "var(--trama-mark-shade)",
  shadeOpacity: 0.72,
  tile: ["var(--trama-mark-deep)", "var(--trama-mark-back)", "var(--trama-mark-tile)", "var(--trama-mark-tile-glow)"],
  tileLights: ["var(--trama-mark-tile)", "var(--trama-mark-tile)"],
  tileShade: "var(--trama-mark-back)",
  tileShadeOpacity: 0.55,
};

export function tramaMarkColors(palette: TramaMarkPalette): TramaMarkColors {
  return palette === "brand" ? BRAND_COLORS : PROVIDER_COLORS;
}
