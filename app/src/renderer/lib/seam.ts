/**
 * The seam (W17): the stitched edge of the agents' bots, used as a sparing accent. Only the uses listed here may
 * draw it, and at most one of them shows on a screen: when two are mounted, the one with the higher priority
 * wins and the other keeps its ordinary look. The rule is in docs/brand/cucitura.md.
 */

/** The approved places, each with what the seam says there. */
export type SeamUse =
  /** Files dragged over the composer: the place where they land. */
  | "fileDrop"
  /** The task the focus bar puts in evidence: the work going on now. */
  | "focus"
  /** The project has no goal yet: the place the first one goes. */
  | "firstGoal"
  /** The start screen: Trama's mark, stitched like the bots. */
  | "logo";

/** A transient, active use beats a lasting one; a place to fill gives way to the work going on. */
export const SEAM_PRIORITY: Record<SeamUse, number> = { fileDrop: 4, focus: 3, firstGoal: 2, logo: 1 };

export interface MountedSeam {
  id: string;
  use: SeamUse;
  /** Mount order, so of two uses with the same priority the first one keeps the seam. */
  order: number;
}

/** The one seam that draws among those mounted, or null. */
export function visibleSeam(mounted: Iterable<MountedSeam>): string | null {
  let best: MountedSeam | null = null;
  for (const seam of mounted) {
    if (!best || SEAM_PRIORITY[seam.use] > SEAM_PRIORITY[best.use] || (SEAM_PRIORITY[seam.use] === SEAM_PRIORITY[best.use] && seam.order < best.order)) {
      best = seam;
    }
  }
  return best?.id ?? null;
}

const mounted = new Map<string, MountedSeam>();
const listeners = new Set<() => void>();
let order = 0;
let shown: string | null = null;

function update() {
  const next = visibleSeam(mounted.values());
  if (next === shown) return;
  shown = next;
  for (const listener of listeners) listener();
}

/** Registers a mounted use; the returned function removes it. */
export function mountSeam(id: string, use: SeamUse): () => void {
  mounted.set(id, { id, use, order: order++ });
  update();
  return () => {
    mounted.delete(id);
    update();
  };
}

export function subscribeSeams(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function shownSeam(): string | null {
  return shown;
}
