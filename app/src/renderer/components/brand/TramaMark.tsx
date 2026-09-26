import { useId, type SVGProps } from "react";
import { cn } from "@/lib/cn";
import { tramaMarkColors, usesSmallGlyph, type TramaMarkPalette, type TramaMarkVariant } from "./tramaMarkPalette";
import {
  GLYPH_PATH,
  GLYPH_SHADOWS,
  GLYPH_VIEW_BOX,
  SILHOUETTE_PATH,
  SMALL_GLYPH_PATH,
  TILE_GLYPH_TRANSFORM,
  TILE_PATH,
  TILE_SMALL_GLYPH_TRANSFORM,
  TILE_VIEW_BOX,
} from "./tramaMarkGeometry";

export type { TramaMarkPalette, TramaMarkVariant } from "./tramaMarkPalette";

export interface TramaMarkProps extends Omit<SVGProps<SVGSVGElement>, "children" | "width" | "height" | "viewBox"> {
  /** Side in CSS pixels. Up to 32 the simplified glyph is drawn. Default 24. */
  size?: number;
  /** "glyph": the symbol with gradient and shadows; "tile": the app icon's tile with the white symbol; "mono": the symbol in currentColor. Default "glyph". */
  variant?: TramaMarkVariant;
  /** "provider" follows the provider theme in use, in light and dark; "brand" keeps the app icon's colors. Default "provider". */
  palette?: TramaMarkPalette;
  /** Accessible name. Without it the mark is decorative and hidden from screen readers. */
  title?: string;
}

/** Trama's mark: two ribbons woven into a "T" (B01). The API is stable; docs/brand/README.md documents it. */
export function TramaMark({ size = 24, variant = "glyph", palette = "provider", title, className, ...props }: TramaMarkProps) {
  const id = `trama-mark-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const small = usesSmallGlyph(size);
  const colors = tramaMarkColors(palette);
  const svgProps = {
    width: size,
    height: size,
    className: cn("shrink-0", className),
    "data-trama-mark": variant,
    "data-trama-mark-palette": palette,
    ...(title ? { role: "img", "aria-label": title } : { "aria-hidden": true }),
    ...props,
  };

  if (variant === "mono") {
    return (
      <svg viewBox={GLYPH_VIEW_BOX} {...svgProps}>
        {title ? <title>{title}</title> : null}
        <path fill="currentColor" fillRule={small ? "evenodd" : undefined} d={small ? SMALL_GLYPH_PATH : GLYPH_PATH} />
      </svg>
    );
  }

  if (variant === "tile") {
    return (
      <svg viewBox={TILE_VIEW_BOX} {...svgProps}>
        {title ? <title>{title}</title> : null}
        <defs>
          <linearGradient id={`${id}-tile`} x1="0" y1="1024" x2="1024" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" style={{ stopColor: colors.tile[0] }} />
            <stop offset="0.55" style={{ stopColor: colors.tile[1] }} />
            <stop offset="1" style={{ stopColor: colors.tile[2] }} />
          </linearGradient>
          <RadialLight id={`${id}-tl`} cx={82} cy={20} r={512} color={colors.tileLights[0]} opacity={0.85} />
          <RadialLight id={`${id}-br`} cx={1004} cy={1004} r={461} color={colors.tileLights[1]} opacity={0.8} />
          <radialGradient id={`${id}-glow`} cx="983" cy="41" r="635" gradientUnits="userSpaceOnUse">
            <stop offset="0" style={{ stopColor: colors.tile[3] }} />
            <stop offset="0.45" style={{ stopColor: colors.tile[2], stopOpacity: 0.55 }} />
            <stop offset="1" style={{ stopColor: colors.tile[2], stopOpacity: 0 }} />
          </radialGradient>
        </defs>
        {["tile", "tl", "br", "glow"].map((layer) => (
          <path key={layer} fill={`url(#${id}-${layer})`} d={TILE_PATH} />
        ))}
        {small ? (
          <path transform={TILE_SMALL_GLYPH_TRANSFORM} fill="#fff" fillRule="evenodd" d={SMALL_GLYPH_PATH} />
        ) : (
          <g transform={TILE_GLYPH_TRANSFORM}>
            <path fill="#fff" fillOpacity={0.16} d={SILHOUETTE_PATH} />
            <path fill="#fff" d={GLYPH_PATH} />
            <Shadows id={id} color={colors.tileShade} opacity={colors.tileShadeOpacity} />
          </g>
        )}
      </svg>
    );
  }

  return (
    <svg viewBox={GLYPH_VIEW_BOX} {...svgProps}>
      {title ? <title>{title}</title> : null}
      <defs>
        <linearGradient id={`${id}-face`} x1="40" y1="200" x2="540" y2="40" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: colors.face[0] }} />
          <stop offset="0.45" style={{ stopColor: colors.face[1] }} />
          <stop offset="0.75" style={{ stopColor: colors.face[2] }} />
          <stop offset="1" style={{ stopColor: colors.face[3] }} />
        </linearGradient>
        <linearGradient id={`${id}-back`} x1="280" y1="160" x2="280" y2="540" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: colors.back[0] }} />
          <stop offset="1" style={{ stopColor: colors.back[1] }} />
        </linearGradient>
      </defs>
      {small ? (
        <path fill={`url(#${id}-face)`} fillRule="evenodd" d={SMALL_GLYPH_PATH} />
      ) : (
        <>
          <path fill={`url(#${id}-back)`} d={SILHOUETTE_PATH} />
          <path fill={`url(#${id}-face)`} d={GLYPH_PATH} />
          <Shadows id={id} color={colors.shade} opacity={colors.shadeOpacity} />
        </>
      )}
    </svg>
  );
}

function RadialLight({ id, cx, cy, r, color, opacity }: { id: string; cx: number; cy: number; r: number; color: string; opacity: number }) {
  return (
    <radialGradient id={id} cx={cx} cy={cy} r={r} gradientUnits="userSpaceOnUse">
      <stop offset="0" style={{ stopColor: color, stopOpacity: opacity }} />
      <stop offset="1" style={{ stopColor: color, stopOpacity: 0 }} />
    </radialGradient>
  );
}

/** Where a ribbon passes under another one it darkens, strongest at the crossing. */
function Shadows({ id, color, opacity }: { id: string; color: string; opacity: number }) {
  return (
    <>
      <defs>
        {GLYPH_SHADOWS.map((s, i) => (
          <radialGradient key={i} id={`${id}-s${i}`} cx={s.cx} cy={s.cy} r={s.r} gradientUnits="userSpaceOnUse">
            <stop offset="0" style={{ stopColor: color, stopOpacity: opacity }} />
            <stop offset="0.55" style={{ stopColor: color, stopOpacity: opacity * 0.42 }} />
            <stop offset="1" style={{ stopColor: color, stopOpacity: 0 }} />
          </radialGradient>
        ))}
      </defs>
      {GLYPH_SHADOWS.map((s, i) => (
        <path key={i} fill={`url(#${id}-s${i})`} d={s.d} />
      ))}
    </>
  );
}
