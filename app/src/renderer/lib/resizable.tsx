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

/**
 * The edge of a panel: drag to resize, double-click to reset, arrow keys from the keyboard.
 * `side` is the edge the handle sits on; dragging away from the panel widens it.
 * A click without dragging calls `onClick`, so an edge that used to toggle the panel keeps doing it.
 */
export function ResizeHandle({
  side,
  width,
  min,
  max,
  onResize,
  onReset,
  onClick,
  onDragChange,
  label,
  className,
}: {
  side: "left" | "right";
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
  onReset: () => void;
  onClick?: () => void;
  onDragChange?: (dragging: boolean) => void;
  label: string;
  className?: string;
}) {
  const drag = useRef<{ x: number; width: number; moved: boolean } | null>(null);
  const [active, setActive] = useState(false);
  // A single click waits for a possible second one, so a double-click resets without also toggling.
  const pendingClick = useRef<number | null>(null);
  // Pointer events carry no click count, so the click itself decides; a drag that just ended is not a click.
  const lastDragMoved = useRef(false);
  useEffect(() => () => window.clearTimeout(pendingClick.current ?? undefined), []);
  const direction = side === "left" ? -1 : 1;
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-active={active || undefined}
      className={cn("panel-resize-handle no-drag", `panel-resize-handle--${side}`, className)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width, moved: false };
        setActive(true);
        onDragChange?.(true);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start) return;
        const delta = (event.clientX - start.x) * direction;
        if (Math.abs(delta) > 3) start.moved = true;
        if (start.moved) onResize(start.width + delta);
      }}
      onPointerUp={(event) => {
        const start = drag.current;
        drag.current = null;
        setActive(false);
        onDragChange?.(false);
        event.currentTarget.releasePointerCapture(event.pointerId);
        lastDragMoved.current = Boolean(start?.moved);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setActive(false);
        onDragChange?.(false);
      }}
      onClick={(event) => {
        if (lastDragMoved.current || !onClick || event.detail !== 1) return;
        pendingClick.current = window.setTimeout(onClick, 240);
      }}
      onDoubleClick={() => {
        window.clearTimeout(pendingClick.current ?? undefined);
        onReset();
      }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 64 : 16;
        if (event.key === "ArrowLeft") onResize(width - step * direction);
        else if (event.key === "ArrowRight") onResize(width + step * direction);
        else if (event.key === "Home") onReset();
        else return;
        event.preventDefault();
      }}
    />
  );
}
