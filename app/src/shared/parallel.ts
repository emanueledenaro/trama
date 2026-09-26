import type { ProjectDocument } from "./domain";

/** Developers at work at the same time in a project unless the person changes it (spec #137, Q5). */
export const DEFAULT_PARALLEL_DEVELOPERS = 3;
/** The range the project setting accepts (W08); the fixed roles never count. */
export const MIN_PARALLEL_DEVELOPERS = 1;
export const MAX_PARALLEL_DEVELOPERS_SETTING = 6;

/** A requested limit brought into the accepted range, or null when it is not a whole number. */
export function clampParallelDevelopers(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return Math.min(MAX_PARALLEL_DEVELOPERS_SETTING, Math.max(MIN_PARALLEL_DEVELOPERS, value));
}

/** How many developers may work in parallel in this project: the person's setting, or three (W08). */
export function parallelDevelopers(document: Pick<ProjectDocument, "settings">): number {
  return clampParallelDevelopers(document.settings?.parallelDevelopers) ?? DEFAULT_PARALLEL_DEVELOPERS;
}
