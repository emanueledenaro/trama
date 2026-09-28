import { afterEach, describe, expect, it } from "vitest";
import type { PresenceEntry, PresenceRecord, PresenceView } from "@shared/presence";
import type { RecentProject } from "@shared/domain";
import { emptyDocument } from "./document";
import { activeColleagues, summarizeProject } from "./overview";
import { setPersonLanguage } from "./personLanguage";

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

describe("overview reasons in English (issue #301)", () => {
  afterEach(() => setPersonLanguage("it"));

  it("uses the singular and the plural of the language", () => {
    const recent: RecentProject = { id: "a", name: "Alfa", path: "/tmp/Alfa", isDemo: true, lastOpenedAt: "2026-09-23T10:00:00.000Z" };
    const input = { source: "live" as const, selected: false, candidateReports: [], ci: { passing: 0, failing: 1, pending: 0 } };
    setPersonLanguage("en");
    const english = summarizeProject(recent, emptyDocument("a"), { ...input, runningAssignments: 2, waitingForCapacity: 1 });
    expect(english.name).toBe("Example project");
    expect(english.reasons).toEqual(["2 assignments in progress", "1 assignment waits for a free Developer", "CI red on 1 pull request"]);
    setPersonLanguage("it");
    const italian = summarizeProject(recent, emptyDocument("a"), { ...input, runningAssignments: 1, waitingForCapacity: 2 });
    expect(italian.name).toBe("Progetto di esempio");
    expect(italian.reasons).toEqual(["1 incarico in corso", "2 incarichi aspettano uno sviluppatore libero", "CI rossa su 1 pull request"]);
  });
});
