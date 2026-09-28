import { describe, expect, it } from "vitest";
import { it as italian } from "@shared/messages/it";
import { en } from "@shared/messages/en";
import {
  CHAT_MIN_WIDTH,
  SIDE_BAR_MIN_WIDTH,
  TAB_LABELS,
  VIEW_LABELS,
  VIEW_OF,
  VIEW_TABS,
  homeOf,
  isDetail,
  parentOf,
  sideBarDefaultWidth,
  sideBarMaxWidth,
  tabOf,
  viewOf,
} from "./workbench";

describe("window layout (issue #330)", () => {
  it("opens every panel of today under a view of the activity bar", () => {
    const kinds = Object.keys(VIEW_OF);
    // The kinds of InspectorTarget in lib/store.ts; the Record type keeps this list complete at compile time.
    expect(kinds.sort()).toEqual(
      [
        "activity",
        "agentThread",
        "audit",
        "branch",
        "candidate",
        "commit",
        "decision",
        "file",
        "goal",
        "goals",
        "group",
        "issue",
        "issues",
        "map",
        "mandate",
        "memory",
        "module",
        "pact",
        "pullRequest",
        "specialist",
        "standard",
        "team",
        "waiting",
        "work",
      ].sort(),
    );
    expect(viewOf({ kind: "map" })).toBe("rules");
    expect(viewOf({ kind: "pact" })).toBe("rules");
    expect(viewOf({ kind: "standard" })).toBe("rules");
    expect(viewOf({ kind: "group" })).toBe("work");
    expect(viewOf({ kind: "issue", number: 7 })).toBe("work");
    expect(viewOf({ kind: "team" })).toBe("teams");
    expect(viewOf({ kind: "specialist", id: "S-1" })).toBe("teams");
  });

  it("puts each detail under the tab of its list, with a way back", () => {
    // Issue #334: the map is the Moduli section of Mandato; a module goes back to the modules.
    expect(tabOf({ kind: "map" })).toBe("mandate");
    expect(tabOf({ kind: "module", id: "Orders" })).toBe("mandate");
    expect(tabOf({ kind: "file", path: "src/a.ts" })).toBe("mandate");
    expect(parentOf({ kind: "module", id: "Orders" })).toEqual({ kind: "map" });
    expect(parentOf({ kind: "decision", id: "D-1" })).toEqual({ kind: "pact" });
    expect(tabOf({ kind: "candidate", id: "C-1" })).toBe("work");
    // Issue #332: Lavoro is one view, so every detail of it goes back to it.
    expect(tabOf({ kind: "goal", id: "G-1" })).toBe("work");
    expect(tabOf({ kind: "pullRequest", number: 4 })).toBe("work");
    expect(tabOf({ kind: "issue", number: 7 })).toBe("work");
    expect(tabOf({ kind: "mandate" })).toBe("mandate");
    expect(isDetail({ kind: "module", id: "Orders" })).toBe(true);
    expect(isDetail({ kind: "specialist", id: "S-1" })).toBe(true);
    expect(isDetail({ kind: "activity", work: "W-1" })).toBe(true);
    expect(isDetail({ kind: "goals", create: true })).toBe(true);
    expect(isDetail({ kind: "waiting", key: "question:1" })).toBe(false);
    expect(isDetail({ kind: "map" })).toBe(false);
    // Activity opens under Lavoro, with a way back to it, until the bottom panel (B08).
    expect(isDetail({ kind: "activity" })).toBe(true);
    expect(isDetail({ kind: "goals" })).toBe(false);
    expect(isDetail({ kind: "group" })).toBe(false);
    expect(isDetail({ kind: "issues" })).toBe(false);
    expect(isDetail({ kind: "work" })).toBe(false);
  });

  it("lists every tab inside its own view and opens a view on its first tab", () => {
    for (const [view, tabs] of Object.entries(VIEW_TABS)) {
      for (const tab of tabs) expect(VIEW_OF[tab]).toBe(view);
      if (tabs.length > 1) for (const tab of tabs) expect(TAB_LABELS[tab]).toBeDefined();
    }
    expect(homeOf("work")).toEqual({ kind: "work" });
    expect(VIEW_TABS.work).toEqual(["work"]);
    expect(homeOf("rules")).toEqual({ kind: "mandate" });
    expect(VIEW_TABS.rules).toEqual(["mandate", "pact", "standard"]);
    expect(homeOf("projects")).toBeNull();
  });

  it("names every view and tab in Italian and English", () => {
    for (const key of [...Object.values(VIEW_LABELS), ...Object.values(TAB_LABELS)]) {
      expect(italian[key]).toBeTruthy();
      expect(en[key]).toBeTruthy();
    }
  });

  it("sizes the side bar as the issue asks and keeps the chat at least 420 px wide", () => {
    expect(sideBarDefaultWidth(1280)).toBe(300);
    expect(sideBarDefaultWidth(1680)).toBe(340);
    // 1066x666 is a 1280x800 window at 120% zoom.
    expect(1066 - 48 - sideBarMaxWidth(1066)).toBeGreaterThanOrEqual(CHAT_MIN_WIDTH);
    expect(sideBarMaxWidth(720)).toBeGreaterThanOrEqual(SIDE_BAR_MIN_WIDTH);
  });
});
