import { describe, expect, it } from "vitest";
import type { PresenceEntry, PresenceView } from "@shared/presence";
import { activeColleagues } from "./overview";

const entry = (status: PresenceEntry["status"]) => ({ status, idleMinutes: null, lastSeenAt: null, self: false, record: {} }) as unknown as PresenceEntry;

describe("recent project colleagues", () => {
  it("counts active and idle colleagues, never offline ones, and stays unknown without a reading", () => {
    expect(activeColleagues(null)).toBeNull();
    expect(activeColleagues(undefined)).toBeNull();
    const view = { others: [entry("active"), entry("idle"), entry("offline")] } as unknown as PresenceView;
    expect(activeColleagues(view)).toBe(2);
    expect(activeColleagues({ ...view, others: [] })).toBe(0);
  });
});
