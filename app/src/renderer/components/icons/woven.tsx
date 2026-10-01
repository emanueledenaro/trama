import { createElement, type CSSProperties } from "react";
import { cn } from "@/lib/cn";

/** An icon's strokes and its back thread (scripts/build-trama-icons.mjs). */
export interface WovenIcon {
  filled: boolean;
  node: [string, Record<string, string>][];
  /** The strokes drawn faint, as the ribbon of the logo that passes behind: empty for an icon in one thread. */
  back: number[];
}

/** How much of the color the back thread keeps. */
export const BACK_THREAD_OPACITY = 0.42;

export interface WovenIconProps {
  className?: string;
  /** The stroke width, as Tabler's `stroke`. */
  stroke?: number | string;
  size?: number | string;
  style?: CSSProperties;
  color?: string;
  title?: string;
  "aria-label"?: string;
}

/** Draws one of Trama's icons with the props of a Tabler icon, so it replaces one where it is used. */
export function Woven({ icon, slug, className, stroke = 2, size = 24, style, color = "currentColor", title, ...aria }: WovenIconProps & { icon: WovenIcon; slug: string }) {
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
      {icon.node.map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs, opacity: icon.back.includes(i) ? BACK_THREAD_OPACITY : undefined }))}
    </svg>
  );
}
