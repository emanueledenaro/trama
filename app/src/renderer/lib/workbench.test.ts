import { describe, expect, it } from "vitest";
import { it as italian } from "@shared/messages/it";
import { en } from "@shared/messages/en";
import {
  ACTIVITY_BAR_WIDTH,
  CHAT_MIN_WIDTH,
  DETAIL_PANE_MIN_WIDTH,
  SPLIT_EDITOR_MIN_VIEWPORT,
  detailKey,
  detailPaneDefaultWidth,
  detailPaneMaxWidth,
  opensInEditor,
  splitsEditor,
  EDITOR_MIN_HEIGHT,
  PANEL_DOCKED_MIN_VIEWPORT,
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
  panelOverlays,
  fitPanels,
  sheetMargins,
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
    expect(isDetail({ kind: "goals", create: true })).toBe(true);
    expect(isDetail({ kind: "waiting", key: "question:1" })).toBe(false);
    expect(isDetail({ kind: "map" })).toBe(false);
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
    // The narrowest window: the side bar goes from 240 to 252 px and the chat keeps 420.
    expect(sideBarMaxWidth(720)).toBe(252);
    // Above 1200 px the sheet has 8 px on each side, and they count.
    for (const viewport of [1201, 1208, 1280, 1400]) {
      expect(viewport - 48 - sheetMargins(viewport) - sideBarMaxWidth(viewport)).toBeGreaterThanOrEqual(CHAT_MIN_WIDTH);
    }
    expect(sheetMargins(1200)).toBe(0);
    expect(sheetMargins(1201)).toBe(16);
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
    // From 716 px the editor keeps 526 px above the panel; lower, the panel lies over the editor.
    expect(PANEL_DOCKED_MIN_VIEWPORT).toBe(716);
    expect(panelOverlays(716)).toBe(false);
    expect(panelOverlays(715)).toBe(true);
    expect(716 - 70 - panelMaxHeight(716)).toBe(EDITOR_MIN_HEIGHT);
    expect(panelMaxHeight(716)).toBe(PANEL_MIN_HEIGHT);
    expect(panelMaxHeight(640)).toBeGreaterThanOrEqual(PANEL_MIN_HEIGHT);
    expect(panelMaxHeight(640)).toBeLessThan(640 - 70);
  });
});

describe("editor tabs (issue #336)", () => {
  it("opens the details in editor tabs and keeps lists, tabs and forms in the side bar", () => {
    for (const target of [
      { kind: "specialist", id: "S-1" },
      { kind: "candidate", id: "C-1" },
      { kind: "audit", id: "F-1" },
      { kind: "decision", id: "D-1" },
      { kind: "issue", number: 7 },
      { kind: "pullRequest", number: 8 },
      { kind: "module", id: "Orders" },
      { kind: "goal", id: "G-1" },
    ] as const) {
      expect(opensInEditor(target)).toBe(true);
    }
    for (const target of [{ kind: "team" }, { kind: "work" }, { kind: "map" }, { kind: "waiting" }, { kind: "goals", create: true }] as const) {
      expect(opensInEditor(target)).toBe(false);
    }
  });

  it("gives the same record the same tab, whatever the target brings into view", () => {
    expect(detailKey({ kind: "candidate", id: "C-1" })).toBe(detailKey({ kind: "candidate", id: "C-1", audit: "F-2", diff: true }));
    expect(detailKey({ kind: "goal", id: "G-1" })).toBe(detailKey({ kind: "goal", id: "G-1", edit: true }));
    expect(detailKey({ kind: "candidate", id: "C-1" })).not.toBe(detailKey({ kind: "candidate", id: "C-2" }));
    expect(detailKey({ kind: "issue", number: 7 })).not.toBe(detailKey({ kind: "pullRequest", number: 7 }));
  });

  it("splits the editor from about 1500 px, only when the person keeps the switch on", () => {
    expect(SPLIT_EDITOR_MIN_VIEWPORT).toBe(1500);
    expect(splitsEditor(1280, true)).toBe(false);
    expect(splitsEditor(1680, true)).toBe(true);
    expect(splitsEditor(1680, false)).toBe(false);
  });

  it("keeps the conversation at least 420 px wide beside the details and the side bar", () => {
    for (const viewport of [1500, 1680, 1920]) {
      const detail = Math.min(detailPaneDefaultWidth(viewport), detailPaneMaxWidth(viewport));
      expect(detail).toBeGreaterThanOrEqual(DETAIL_PANE_MIN_WIDTH);
      expect(viewport - ACTIVITY_BAR_WIDTH - sideBarDefaultWidth(viewport) - detailPaneMaxWidth(viewport)).toBeGreaterThanOrEqual(CHAT_MIN_WIDTH);
    }
  });

  it("fits the side bar and the details together, whatever widths the person chose", () => {
    for (const viewport of [1500, 1680, 1920, 2560]) {
      for (const [side, detail] of [
        [720, 900],
        [240, 900],
        [720, 360],
        [300, 440],
      ] as const) {
        const fit = fitPanels(viewport, side, detail);
        expect(fit.detail).toBeGreaterThanOrEqual(DETAIL_PANE_MIN_WIDTH);
        expect(fit.sideBar).toBeGreaterThanOrEqual(SIDE_BAR_MIN_WIDTH);
        expect(viewport - ACTIVITY_BAR_WIDTH - sheetMargins(viewport) - fit.sideBar - fit.detail).toBeGreaterThanOrEqual(CHAT_MIN_WIDTH);
      }
    }
    // A closed panel takes no room: the other may grow into it.
    expect(fitPanels(1500, null, 900).sideBar).toBe(0);
    expect(fitPanels(1500, null, 900).detail).toBe(900);
    expect(fitPanels(1066, 720, null)).toEqual({ sideBar: 1066 - 48 - 420, detail: 0 });
  });
});
