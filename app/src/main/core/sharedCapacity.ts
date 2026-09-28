/**
 * Shared capacity across projects (issue #39). The person may leave a project while its authorized team keeps
 * working, so every open project draws developers from one pool. Work that finds the pool full waits in line, and a
 * freed slot goes to the project the Product Owner ranked first. Opening a project never changes that order.
 */

/** An authorized assignment that waits for a free developer slot. */
export interface CapacityRequest {
  projectId: string;
  assignmentId: string;
  /** Order of arrival: ties in priority go to the work that waited longest. */
  sequence: number;
}

/**
 * The Product Owner's order of the projects: the saved order first, then the projects never ranked, by name. The
 * order of the recent list, which changes each time a project opens, plays no part.
 */
export function projectOrder(saved: readonly string[] | undefined, projects: readonly { id: string; name: string }[]): string[] {
  const known = new Set(projects.map((p) => p.id));
  const ranked = [...new Set(saved ?? [])].filter((id) => known.has(id));
  const rest = projects
    .filter((p) => !ranked.includes(p.id))
    .sort((a, b) => a.name.localeCompare(b.name, "it") || a.id.localeCompare(b.id))
    .map((p) => p.id);
  return [...ranked, ...rest];
}

/** The order after the person moves one project up or down by one place; an unknown project leaves it as it is. */
export function moveProject(order: readonly string[], projectId: string, direction: "up" | "down"): string[] {
  const next = [...order];
  const index = next.indexOf(projectId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/** The requests in the order they get a free slot: project priority first, then arrival. */
export function inLine(queue: readonly CapacityRequest[], order: readonly string[]): CapacityRequest[] {
  const rank = (projectId: string) => {
    const index = order.indexOf(projectId);
    return index < 0 ? order.length : index;
  };
  return [...queue].sort((a, b) => rank(a.projectId) - rank(b.projectId) || a.sequence - b.sequence);
}
