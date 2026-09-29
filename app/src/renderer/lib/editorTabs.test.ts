import { beforeEach, describe, expect, it } from "vitest";
import type { AppState } from "@shared/domain";
import { useUi } from "./store";
import { tabKey } from "./workbench";

// The store only reads these parts of the state to route the details (issue #336).
const appOf = (projectId: string, audits: { id: string; candidateId: string }[] = []) =>
  ({
    project: {
      id: projectId,
      document: { goals: [], audits: audits.map((a) => ({ id: a.id, target: { kind: "candidate", candidateId: a.candidateId, assignmentId: "A-1" } })) },
    },
  }) as unknown as AppState;

const reset = () =>
  useUi.setState({
    app: appOf("p1", [{ id: "F-1", candidateId: "C-1" }]),
    editorTabs: [],
    activeDetail: null,
    editorFocus: "main",
    mainView: "dialog",
    settingsReturn: "dialog",
    inspector: null,
    history: [null],
    historyIndex: 0,
  });

describe("editor tabs (issue #336)", () => {
  beforeEach(reset);

  it("opens a detail in a tab next to the conversation and brings it back when reopened", () => {
    const ui = useUi.getState();
    ui.setInspector({ kind: "specialist", id: "S-1" });
    ui.setInspector({ kind: "candidate", id: "C-1" });
    ui.setInspector({ kind: "specialist", id: "S-1" });
    const state = useUi.getState();
    expect(state.editorTabs.map(tabKey)).toEqual(["detail:specialist:S-1", "detail:candidate:C-1"]);
    expect(state.activeDetail).toBe("detail:specialist:S-1");
    expect(state.editorFocus).toBe("detail");
    // The side bar keeps its view: a detail does not open it.
    expect(state.sidebarOpen).toBe(false);
  });

  it("opens an examination in its candidate's tab", () => {
    useUi.getState().setInspector({ kind: "candidate", id: "C-1" });
    useUi.getState().setInspector({ kind: "audit", id: "F-1" });
    const state = useUi.getState();
    expect(state.editorTabs).toEqual([{ kind: "detail", target: { kind: "candidate", id: "C-1", audit: "F-1" } }]);
  });

  it("never closes the conversation and moves to the neighbour when a tab closes", () => {
    const ui = useUi.getState();
    ui.openDetail({ kind: "decision", id: "D-1" });
    ui.openDetail({ kind: "issue", number: 7 });
    ui.openDetail({ kind: "module", id: "Orders" });
    ui.focusTab("detail:issue:7");
    ui.closeTab("conversation");
    ui.closeTab("detail:issue:7");
    let state = useUi.getState();
    expect(state.editorTabs.map(tabKey)).toEqual(["detail:decision:D-1", "detail:module:Orders"]);
    expect(state.activeDetail).toBe("detail:decision:D-1");
    ui.closeTab("detail:decision:D-1");
    ui.closeTab("detail:module:Orders");
    state = useUi.getState();
    expect(state.editorTabs).toEqual([]);
    expect(state.activeDetail).toBeNull();
    expect(state.editorFocus).toBe("main");
    expect(state.mainView).toBe("dialog");
  });

  it("opens Progetti and Impostazioni as tabs and returns to the conversation when they close", () => {
    const ui = useUi.getState();
    ui.setMainView("overview");
    ui.openSettings("connections");
    let state = useUi.getState();
    expect(state.editorTabs.map(tabKey)).toEqual(["projects", "settings"]);
    expect(state.mainView).toBe("settings");
    ui.closeSettings();
    state = useUi.getState();
    expect(state.mainView).toBe("overview");
    ui.closeTab("projects");
    expect(useUi.getState().mainView).toBe("dialog");
    expect(useUi.getState().editorTabs).toEqual([]);
  });

  it("shows the conversation when the person writes to the Coordinator from a detail", () => {
    useUi.getState().openDetail({ kind: "specialist", id: "S-1" });
    useUi.getState().askCoordinator("Aggiornami sul lavoro di Ada");
    const state = useUi.getState();
    expect(state.editorFocus).toBe("main");
    expect(state.mainView).toBe("dialog");
    expect(state.editorTabs.map(tabKey)).toEqual(["detail:specialist:S-1"]);
  });

  it("closes the details of the old project when the project changes, and keeps Progetti", () => {
    useUi.getState().setMainView("overview");
    useUi.getState().openDetail({ kind: "candidate", id: "C-1" });
    useUi.getState().setApp(appOf("p2"));
    const state = useUi.getState();
    expect(state.editorTabs.map(tabKey)).toEqual(["projects"]);
    expect(state.activeDetail).toBeNull();
  });

  it("goes back from a detail to the one opened before, in its tab", () => {
    const ui = useUi.getState();
    ui.setInspector({ kind: "decision", id: "D-1" });
    ui.setInspector({ kind: "module", id: "Orders" });
    ui.goBack();
    expect(useUi.getState().activeDetail).toBe("detail:decision:D-1");
    ui.goForward();
    expect(useUi.getState().activeDetail).toBe("detail:module:Orders");
  });
});
