import { createElement, type CSSProperties, useId } from "react";
import { cn } from "@/lib/cn";

/** An icon's strokes and the gaps where one passes under another (scripts/build-trama-icons.mjs). */
export interface WovenIcon {
  filled: boolean;
  node: [string, Record<string, string>][];
  /** Each gap's centre, the stroke it cuts and its radius: wider at a crossing, smaller where a ring opens. */
  gaps: { x: number; y: number; under: number; r: number }[];
  /** Outlines that open at the top right, as dash patterns by element. */
  dashes: Record<string, { array: string; offset: number }>;
}

export interface WovenIconProps {
  className?: string;
  /** The stroke width, as Tabler's `stroke`. */
  stroke?: number | string;
  size?: number | string;
  style?: CSSProperties;
  color?: string;
  title?: string;
  "aria-hidden"?: boolean;
  "aria-label"?: string;
}

/** Draws one of Trama's woven icons with the props of a Tabler icon, so it replaces one where it is used. */
export function Woven({ icon, slug, className, stroke = 2, size = 24, style, color = "currentColor", title, ...aria }: WovenIconProps & { icon: WovenIcon; slug: string }) {
  const id = useId().replace(/:/g, "");
  // Under 16 px a small gap reads as a flaw: only the crossings stay, the outlines close and the joints join.
  const small = Number(size) < 16 || /(^|\s)size-3(\.5)?(\s|$)/.test(className ?? "");
  const masks = icon.node.map((_, i) => icon.gaps.filter((g) => g.under === i && (!small || g.r >= 2.5)));
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={icon.filled ? color : "none"}
      stroke={icon.filled ? "none" : color}
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("trama-woven", `trama-woven-${slug}`, className)}
      style={style}
      aria-hidden={aria["aria-label"] ? undefined : true}
      aria-label={aria["aria-label"]}
    >
      {title ? <title>{title}</title> : null}
      <defs>
        {masks.map((gaps, i) =>
          gaps.length ? (
            <mask key={i} id={`${id}-${i}`} maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28">
              <rect x="-2" y="-2" width="28" height="28" fill="white" />
              {gaps.map((g) => (
                <circle key={`${g.x}-${g.y}`} cx={g.x} cy={g.y} r={g.r} fill="black" />
              ))}
            </mask>
          ) : null,
        )}
      </defs>
      {icon.node.map(([tag, attrs], i) => {
        const dash = small ? undefined : icon.dashes[i];
        return createElement(tag, {
          key: i,
          ...attrs,
          mask: masks[i]!.length ? `url(#${id}-${i})` : undefined,
          ...(dash ? { pathLength: 100, strokeDasharray: dash.array, strokeDashoffset: dash.offset } : {}),
        });
      })}
    </svg>
  );
}
