import type { BacklogLedger, ProjectDocument, SquadBacklogOrder } from "./domain";

/**
 * The backlog of each squad (A13, Q20): the slices and the issues of its area not yet taken, in order. The Coordinator
 * orders it and says why in one line; the person moves items and their places win. Trama keeps a place the person
 * chose through a new order of the Coordinator and through a restart, and the new items take the other places.
 * Pure: the main process computes the items and records the orders, the renderer shows them and asks for the moves.
 */

/** Why an item sits where it does, as the Coordinator explains it: Trama's own rule, or the Coordinator's line. */
export type BacklogReason =
  | { kind: "unblocks"; count: number }
  | { kind: "ready" }
  | { kind: "check" }
  | { kind: "finding" }
  | { kind: "paused" }
  | { kind: "blocked"; waitingFor: string[] }
  | { kind: "coordinator"; text: string };

/** Where an item stands: a slice ready, blocked by other slices or paused, or an open problem. */
export type BacklogItemState = "ready" | "blocked" | "paused" | "open";

export interface BacklogItem {
  /** `slice:<plan>:<slice>` or `problem:<id>`: the same item has the same key across orders and restarts. */
  key: string;
  kind: "slice" | "problem";
  /** The slice's id in its breakdown (S2); null for a problem. */
  label: string | null;
  title: string;
  issue: { number: number; url: string } | null;
  state: BacklogItemState;
  /** The slices a blocked slice waits for. */
  waitingFor: string[];
  reason: BacklogReason;
  /** The person chose this item's place. */
  placedByPerson: boolean;
}

export interface SquadBacklogView {
  /** Null for the work no squad owns. */
  squadId: string | null;
  items: BacklogItem[];
}

/** The key of a slice in the backlog. */
export const sliceBacklogKey = (planId: string, sliceId: string) => `slice:${planId}:${sliceId}`;
/** The key of a found problem in the backlog. */
export const problemBacklogKey = (problemId: string) => `problem:${problemId}`;

/** The recorded order of a squad's backlog, when there is one. */
export function backlogOrder(document: Pick<ProjectDocument, "backlog">, squadId: string | null): SquadBacklogOrder | null {
  return document.backlog?.squads.find((s) => s.squadId === squadId) ?? null;
}

function ensureOrder(document: Pick<ProjectDocument, "backlog">, squadId: string | null): SquadBacklogOrder {
  const ledger: BacklogLedger = (document.backlog ??= { squads: [] });
  let order = ledger.squads.find((s) => s.squadId === squadId);
  if (!order) {
    order = { squadId, coordinator: [], orderedAt: null, person: [] };
    ledger.squads.push(order);
  }
  return order;
}

/**
 * The backlog as the person sees it: each item the person placed at its place, the others in the Coordinator's order
 * in the places left. A place beyond the end puts the item last, after the others it follows. Keys of items that left
 * the backlog are ignored, so their places go to the next items.
 */
export function arrangeBacklog(coordinatorKeys: readonly string[], person: readonly { key: string; position: number }[]): string[] {
  const present = new Set(coordinatorKeys);
  const pinned = person.filter((p) => present.has(p.key)).sort((a, b) => a.position - b.position);
  const pinnedKeys = new Set(pinned.map((p) => p.key));
  const rest = coordinatorKeys.filter((key) => !pinnedKeys.has(key));
  const arranged: string[] = [];
  let next = 0;
  for (let place = 0; place < coordinatorKeys.length; place++) {
    if (pinned.length && (pinned[0]!.position <= place || next >= rest.length)) arranged.push(pinned.shift()!.key);
    else arranged.push(rest[next++]!);
  }
  return arranged;
}

/**
 * The person moves an item of the backlog they see to another place. Their order wins: the moved item and every item
 * they placed before keep the place they have after the move. Returns false when nothing moves.
 */
export function moveBacklogItem(
  document: Pick<ProjectDocument, "backlog">,
  squadId: string | null,
  shown: readonly string[],
  key: string,
  to: number,
  now = new Date(),
): boolean {
  const from = shown.indexOf(key);
  const place = Math.max(0, Math.min(shown.length - 1, Math.floor(to)));
  if (from < 0 || place === from) return false;
  const moved = shown.filter((k) => k !== key);
  moved.splice(place, 0, key);
  const order = ensureOrder(document, squadId);
  const at = now.toISOString();
  const placed = new Map(order.person.map((p) => [p.key, p.at]));
  placed.set(key, at);
  order.person = moved.flatMap((k, position) => (placed.has(k) ? [{ key: k, position, at: placed.get(k)! }] : []));
  return true;
}

/** The person gives an item back to the Coordinator's order. Returns false when the person had not placed it. */
export function releaseBacklogItem(document: Pick<ProjectDocument, "backlog">, squadId: string | null, key: string): boolean {
  const order = backlogOrder(document, squadId);
  if (!order?.person.some((p) => p.key === key)) return false;
  order.person = order.person.filter((p) => p.key !== key);
  return true;
}

/**
 * Records the Coordinator's order of a squad's backlog, with a reason for each item. It never moves an item the person
 * placed: the person's places are kept as they are.
 */
export function recordCoordinatorOrder(
  document: Pick<ProjectDocument, "backlog">,
  squadId: string | null,
  entries: readonly { key: string; reason: string }[],
  now = new Date(),
): void {
  const order = ensureOrder(document, squadId);
  const seen = new Set<string>();
  order.coordinator = entries.filter((e) => !seen.has(e.key) && seen.add(e.key)).map((e) => ({ key: e.key, reason: e.reason.trim() }));
  order.orderedAt = now.toISOString();
}
