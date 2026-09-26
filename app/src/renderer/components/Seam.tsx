import { type CSSProperties, type ReactNode, useId, useLayoutEffect, useSyncExternalStore } from "react";
import { mountSeam, type SeamUse, shownSeam, subscribeSeams } from "@/lib/seam";

export interface SeamOptions {
  /** False while the use does not apply, so another use on the screen may take the seam. */
  active?: boolean;
  /** The corner radius of the element the seam follows, as a CSS length. */
  radius?: string;
  /** The stitch color: the provider's accent by default, the agent's color when the seam is about an agent. */
  color?: string;
}

/**
 * The seam (W17) for one approved use: `shown` says whether this use draws it (at most one per screen), and
 * `stitch` is the dashed outline to place inside the element, which needs `position: relative`. The seam is
 * never the only signal of a state: the element keeps its text or icon.
 */
export function useSeam(use: SeamUse, options: SeamOptions = {}): { shown: boolean; stitch: ReactNode } {
  const id = useId();
  const active = options.active ?? true;
  useLayoutEffect(() => (active ? mountSeam(id, use) : undefined), [id, use, active]);
  const shown = useSyncExternalStore(subscribeSeams, () => active && shownSeam() === id);
  const style = { "--seam-radius": options.radius, "--seam-color": options.color } as CSSProperties;
  return {
    shown,
    stitch: shown ? (
      <svg className="seam-stitch" data-seam={use} aria-hidden style={style}>
        <rect />
      </svg>
    ) : null,
  };
}
