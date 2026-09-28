import type { ProjectDocument } from "./domain";

/**
 * Developers at work at the same time in a project unless the person changes it (spec #137, Q5). With squads the
 * default grows with them, up to three squads of three (A10, ADR 0017): `squadLimits` in `@shared/squads`.
 */
export const DEFAULT_PARALLEL_DEVELOPERS = 3;
/** The range the project setting accepts (W08), up to three squads of three (A10); the fixed roles never count. */
export const MIN_PARALLEL_DEVELOPERS = 1;
export const MAX_PARALLEL_DEVELOPERS_SETTING = 9;

/** A requested limit brought into the accepted range, or null when it is not a whole number. */
export function clampParallelDevelopers(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return Math.min(MAX_PARALLEL_DEVELOPERS_SETTING, Math.max(MIN_PARALLEL_DEVELOPERS, value));
}

/** How many developers may work in parallel in this project: the person's setting, or three (W08). */
export function parallelDevelopers(document: Pick<ProjectDocument, "settings">): number {
  return clampParallelDevelopers(document.settings?.parallelDevelopers) ?? DEFAULT_PARALLEL_DEVELOPERS;
}

/**
 * Developers at work at the same time across every open project (issue #39): the projects the person left keep their
 * authorized work, so one project cannot take every provider slot while another waits.
 */
export const DEFAULT_SHARED_DEVELOPERS = 6;
export const MIN_SHARED_DEVELOPERS = 1;
export const MAX_SHARED_DEVELOPERS = 12;

/** A requested shared limit brought into the accepted range, or null when it is not a whole number. */
export function clampSharedDevelopers(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return Math.min(MAX_SHARED_DEVELOPERS, Math.max(MIN_SHARED_DEVELOPERS, value));
}

/** How many developers may work at the same time in all projects together: the person's setting, or six. */
export function sharedDevelopers(settings: { sharedDevelopers?: number }): number {
  return clampSharedDevelopers(settings.sharedDevelopers) ?? DEFAULT_SHARED_DEVELOPERS;
}
