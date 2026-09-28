import { describe, expect, it } from "vitest";
import { it as italian } from "@shared/messages/it";
import { en } from "@shared/messages/en";
import {
  CHAT_MIN_WIDTH,
  EDITOR_MIN_HEIGHT,
  PANEL_MIN_HEIGHT,
  SIDE_BAR_MIN_WIDTH,
  TAB_LABELS,
  VIEW_LABELS,
  VIEW_OF,
  VIEW_TABS,
  homeOf,
  isDetail,
  panelDefaultHeight,
  panelMaxHeight,
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
        "team",
        "waiting",
        "work",
      ].sort(),
    );
    expect(viewOf({ kind: "map" })).toBe("rules");
    expect(viewOf({ kind: "pact" })).toBe("rules");
    expect(viewOf({ kind: "group" })).toBe("work");
    expect(viewOf({ kind: "issue", number: 7 })).toBe("work");
    expect(viewOf({ kind: "team" })).toBe("teams");
    expect(viewOf({ kind: "specialist", id: "S-1" })).toBe("teams");
  });

  it("puts each detail under the tab of its list, with a way back", () => {
    expect(tabOf({ kind: "module", id: "Orders" })).toBe("map");
    expect(tabOf({ kind: "candidate", id: "C-1" })).toBe("work");
    expect(tabOf({ kind: "goal", id: "G-1" })).toBe("goals");
    expect(tabOf({ kind: "mandate" })).toBe("mandate");
    expect(isDetail({ kind: "module", id: "Orders" })).toBe(true);
    expect(isDetail({ kind: "specialist", id: "S-1" })).toBe(true);
    expect(isDetail({ kind: "goals", create: true })).toBe(true);
    expect(isDetail({ kind: "waiting", key: "question:1" })).toBe(false);
    expect(isDetail({ kind: "map" })).toBe(false);
  });

  it("lists every tab inside its own view and opens a view on its first tab", () => {
    for (const [view, tabs] of Object.entries(VIEW_TABS)) {
      for (const tab of tabs) expect(VIEW_OF[tab]).toBe(view);
      if (tabs.length > 1) for (const tab of tabs) expect(TAB_LABELS[tab]).toBeDefined();
    }
    expect(homeOf("work")).toEqual({ kind: "goals" });
    expect(homeOf("rules")).toEqual({ kind: "mandate" });
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

  it("keeps Activity out of the side bar: it opens in the bottom panel (issue #337)", () => {
    expect(Object.keys(VIEW_OF)).not.toContain("activity");
    expect(Object.values(VIEW_TABS).flat()).not.toContain("activity");
  });

  it("sizes the bottom panel as the issue asks and keeps the editor above it (issue #337)", () => {
    expect(panelDefaultHeight(1280)).toBe(200);
    expect(panelDefaultHeight(1680)).toBe(260);
    expect(800 - 70 - panelMaxHeight(800)).toBeGreaterThanOrEqual(EDITOR_MIN_HEIGHT);
    expect(panelMaxHeight(1050)).toBeGreaterThanOrEqual(panelDefaultHeight(1680));
    expect(panelMaxHeight(500)).toBe(PANEL_MIN_HEIGHT);
  });
});
