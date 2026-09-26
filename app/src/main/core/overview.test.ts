import { describe, expect, it } from "vitest";
import type { PresenceEntry, PresenceRecord, PresenceView } from "@shared/presence";
import { activeColleagues } from "./overview";

const now = new Date("2026-09-26T12:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();
const entry = (record: Partial<PresenceRecord>) =>
  ({ status: "active", idleMinutes: null, lastSeenAt: null, self: false, record: { closedAt: null, ...record } }) as unknown as PresenceEntry;
const view = (others: PresenceEntry[]) => ({ others }) as unknown as PresenceView;

describe("recent project colleagues", () => {
  it("stays unknown without a presence reading", () => {
    expect(activeColleagues(null, now)).toBeNull();
    expect(activeColleagues(undefined, now)).toBeNull();
    expect(activeColleagues(view([]), now)).toBe(0);
  });

  it("counts active and idle colleagues with the freshness computed now, never offline ones", () => {
    const active = entry({ updatedAt: minutesAgo(1), lastActivityAt: minutesAgo(1) });
    const idle = entry({ updatedAt: minutesAgo(1), lastActivityAt: minutesAgo(30) });
    const closed = entry({ updatedAt: minutesAgo(1), lastActivityAt: minutesAgo(1), closedAt: minutesAgo(1) });
    // Read as active an hour ago, but the heartbeat is stale now.
    const stale = entry({ updatedAt: minutesAgo(60), lastActivityAt: minutesAgo(60) });
    expect(activeColleagues(view([active, idle, closed, stale]), now)).toBe(2);
  });
});
