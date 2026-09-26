import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

export interface WidthBounds {
  initial: number;
  min: number;
  /** Upper bound in pixels, or a function of the window width. */
  max: number | ((viewport: number) => number);
}

const upper = (bounds: WidthBounds) => (typeof bounds.max === "number" ? bounds.max : bounds.max(window.innerWidth));

export const clampWidth = (width: number, min: number, max: number) => Math.round(Math.min(Math.max(width, min), Math.max(min, max)));

function readWidth(key: string, bounds: WidthBounds): number {
  try {
    const saved = Number(localStorage.getItem(key));
    if (Number.isFinite(saved) && saved > 0) return clampWidth(saved, bounds.min, upper(bounds));
  } catch {
    // Storage can be missing or blocked: the default width still works.
  }
  return bounds.initial;
}

/** A panel width the person can change, remembered on this device and kept within bounds when the window changes. */
export function useResizableWidth(key: string, bounds: WidthBounds) {
  const [width, setWidthState] = useState(() => readWidth(key, bounds));
  // While the person drags, width transitions are off so the panel follows the pointer.
  const [resizing, setResizing] = useState(false);
  const setWidth = useCallback(
    (next: number) => {
      const value = clampWidth(next, bounds.min, upper(bounds));
      setWidthState(value);
      try {
        localStorage.setItem(key, String(value));
      } catch {
        // Not remembered; the width still applies now.
      }
    },
    // Bounds are constants of each panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  useEffect(() => {
    const onResize = () => setWidthState((current) => clampWidth(current, bounds.min, upper(bounds)));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { width, setWidth, resizing, setResizing, reset: () => setWidth(bounds.initial), bounds: { min: bounds.min, max: upper(bounds) } };
}

/** Which way a sash moves: a vertical sash splits panels side by side, a horizontal one splits them top and bottom. */
export type SashOrientation = "vertical" | "horizontal";

/** The panel edge a sash sits on. Dragging away from the panel makes it bigger. */
export type SashSide = "left" | "right" | "top" | "bottom";

export const sashOrientation = (side: SashSide): SashOrientation => (side === "left" || side === "right" ? "vertical" : "horizontal");

/**
 * How many pixels a key moves the edge: 16, or 64 with Shift. Only the arrows along the sash's axis count.
 * The result is the change of the panel size, so it is already signed for the panel's side.
 */
export function sashKeyDelta(side: SashSide, key: string, shift: boolean): number | null {
  const step = shift ? 64 : 16;
  const [less, more] = sashOrientation(side) === "vertical" ? ["ArrowLeft", "ArrowRight"] : ["ArrowUp", "ArrowDown"];
  const grows = side === "right" || side === "bottom" ? 1 : -1;
  if (key === more) return step * grows;
  if (key === less) return -step * grows;
  return null;
}

/** How long the pointer rests on a sash before it lights up, as in VS Code. */
export const SASH_HOVER_DELAY = 300;

/**
 * The separator between two panels, the same for every resizable panel, modeled on VS Code's sash
 * (src/vs/base/browser/ui/sash/sash.ts). It draws nothing at rest: the line is the panel's own 1px border, and the
 * sash is a 4px invisible grip centered on it. After 300ms of hover (`hover` class), while dragged (`active`) and
 * while focused from the keyboard it shows a 4px strip in the provider's accent (index.css, `.sash`).
 * Drag to resize, double-click or Home to return to the default size, arrow keys to step.
 * The sash sits on the start edge (left or top) of its positioned parent.
 * A click without dragging calls `onClick`, so an edge that used to toggle the panel keeps doing it.
 */
export function Sash({
  side,
  size,
  min,
  max,
  onResize,
  onReset,
  onClick,
  onDragChange,
  label,
  className,
}: {
  side: SashSide;
  size: number;
  min: number;
  max: number;
  onResize: (size: number) => void;
  onReset: () => void;
  onClick?: () => void;
  onDragChange?: (dragging: boolean) => void;
  label: string;
  className?: string;
}) {
  const drag = useRef<{ at: number; size: number; moved: boolean } | null>(null);
  const [active, setActive] = useState(false);
  const [hover, setHover] = useState(false);
  const hoverDelay = useRef<number | null>(null);
  // A single click waits for a possible second one, so a double-click resets without also toggling.
  const pendingClick = useRef<number | null>(null);
  // Pointer events carry no click count, so the click itself decides; a drag that just ended is not a click.
  const lastDragMoved = useRef(false);
  useEffect(
    () => () => {
      window.clearTimeout(pendingClick.current ?? undefined);
      window.clearTimeout(hoverDelay.current ?? undefined);
    },
    [],
  );
  const orientation = sashOrientation(side);
  const direction = side === "left" || side === "top" ? -1 : 1;
  const pointerAt = (event: React.PointerEvent) => (orientation === "vertical" ? event.clientX : event.clientY);
  const end = () => {
    drag.current = null;
    setActive(false);
    onDragChange?.(false);
  };
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={size}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={cn(
        "sash no-drag",
        `sash--${orientation}`,
        hover && "hover",
        active && "active",
        size <= min && "sash--minimum",
        size >= max && "sash--maximum",
        className,
      )}
      onPointerEnter={() => {
        window.clearTimeout(hoverDelay.current ?? undefined);
        hoverDelay.current = window.setTimeout(() => setHover(true), SASH_HOVER_DELAY);
      }}
      onPointerLeave={() => {
        window.clearTimeout(hoverDelay.current ?? undefined);
        setHover(false);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { at: pointerAt(event), size, moved: false };
        window.clearTimeout(hoverDelay.current ?? undefined);
        setHover(true);
        setActive(true);
        onDragChange?.(true);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start) return;
        const delta = (pointerAt(event) - start.at) * direction;
        if (Math.abs(delta) > 3) start.moved = true;
        if (start.moved) onResize(start.size + delta);
      }}
      onPointerUp={(event) => {
        lastDragMoved.current = Boolean(drag.current?.moved);
        end();
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={end}
      onClick={(event) => {
        if (lastDragMoved.current || !onClick || event.detail !== 1) return;
        pendingClick.current = window.setTimeout(onClick, 240);
      }}
      onDoubleClick={() => {
        window.clearTimeout(pendingClick.current ?? undefined);
        onReset();
      }}
      onKeyDown={(event) => {
        const delta = sashKeyDelta(side, event.key, event.shiftKey);
        if (delta !== null) onResize(size + delta);
        else if (event.key === "Home") onReset();
        else return;
        event.preventDefault();
      }}
    />
  );
}
