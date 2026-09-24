import { create } from "zustand";
import type { AppState } from "@shared/domain";
import type { ActionName, ActionPayload, ActionResult } from "@shared/ipc";

export type InspectorTarget =
  | { kind: "map" }
  | { kind: "module"; id: string }
  | { kind: "file"; path: string }
  | { kind: "pact" }
  | { kind: "decision"; id: string }
  | { kind: "mandate" }
  | { kind: "memory" }
  | { kind: "team" }
  | { kind: "specialist"; id: string }
  | { kind: "candidate"; id: string }
  | { kind: "group" }
  | { kind: "work" }
  | { kind: "issues" }
  | { kind: "issue"; number: number }
  | { kind: "goals"; create?: boolean }
  | { kind: "goal"; id: string };

/** The main pane: a dialog with the Coordinator, or the projects overview (UX03). */
export type MainView = "dialog" | "overview";

export type DialogName = "settings" | "connections" | "createProject" | "search" | null;

interface UiState {
  app: AppState | null;
  sidebarOpen: boolean;
  inspector: InspectorTarget | null;
  dialog: DialogName;
  toast: string | null;
  composerFocusRequest: number;
  composerModuleId: string | null;
  mainView: MainView;
  /** The goal whose dialog is shown; null is the project dialog (UX02). */
  dialogGoalId: string | null;
  /** A goal to open once its project is the selected one, after a switch from the overview. */
  pendingGoal: { projectId: string; goalId: string } | null;
  setMainView(view: MainView): void;
  openDialog(goalId: string | null): void;
  openGoalOf(projectId: string, goalId: string): void;
  /** Inspector history for the back and forward buttons, as Synara's app navigation. */
  history: (InspectorTarget | null)[];
  historyIndex: number;
  goBack(): void;
  goForward(): void;
  setApp(state: AppState): void;
  toggleSidebar(): void;
  setInspector(target: InspectorTarget | null): void;
  toggleInspector(target: InspectorTarget): void;
  setDialog(dialog: DialogName): void;
  setToast(message: string | null): void;
  focusComposer(moduleId?: string | null): void;
  setComposerModule(moduleId: string | null): void;
}

const readSidebar = () => {
  try {
    return localStorage.getItem("trama.sidebarOpen") !== "false";
  } catch {
    return true;
  }
};

export const useUi = create<UiState>((set, get) => ({
  app: null,
  sidebarOpen: readSidebar(),
  inspector: null,
  dialog: null,
  toast: null,
  composerFocusRequest: 0,
  composerModuleId: null,
  mainView: "dialog",
  dialogGoalId: null,
  pendingGoal: null,
  setMainView: (mainView) => set({ mainView }),
  openDialog: (dialogGoalId) => set({ dialogGoalId, mainView: "dialog" }),
  openGoalOf: (projectId, goalId) => {
    if (get().app?.project?.id === projectId) set({ dialogGoalId: goalId, mainView: "dialog", pendingGoal: null });
    else set({ pendingGoal: { projectId, goalId }, mainView: "dialog" });
  },
  history: [null],
  historyIndex: 0,
  goBack: () => {
    const { history, historyIndex } = get();
    if (historyIndex > 0) set({ historyIndex: historyIndex - 1, inspector: history[historyIndex - 1] ?? null });
  },
  goForward: () => {
    const { history, historyIndex } = get();
    if (historyIndex < history.length - 1) set({ historyIndex: historyIndex + 1, inspector: history[historyIndex + 1] ?? null });
  },
  setApp: (app) => {
    const previous = get().app;
    // A different project resets the panels that point into the old one.
    if (previous?.project?.id !== app.project?.id) {
      const pending = get().pendingGoal;
      const goal = pending && pending.projectId === app.project?.id ? pending.goalId : null;
      set({ inspector: null, composerModuleId: null, history: [null], historyIndex: 0, dialogGoalId: goal, pendingGoal: goal ? null : pending });
    }
    // A goal that no longer exists falls back to the project dialog.
    const goalId = get().dialogGoalId;
    if (goalId && !app.project?.document.goals?.some((g) => g.id === goalId)) set({ dialogGoalId: null });
    set({ app });
  },
  toggleSidebar: () => {
    const next = !get().sidebarOpen;
    try {
      localStorage.setItem("trama.sidebarOpen", String(next));
    } catch {
      // Ignore storage failures.
    }
    set({ sidebarOpen: next });
  },
  setInspector: (inspector) => {
    const { history, historyIndex, inspector: current } = get();
    // Details belong to a project dialog: opening one leaves the overview.
    if (inspector) set({ mainView: "dialog" });
    if (JSON.stringify(current) === JSON.stringify(inspector)) return;
    const next = [...history.slice(0, historyIndex + 1), inspector].slice(-50);
    set({ inspector, history: next, historyIndex: next.length - 1 });
  },
  toggleInspector: (target) => {
    const current = get().inspector;
    get().setInspector(current && current.kind === target.kind ? null : target);
  },
  setDialog: (dialog) => set({ dialog }),
  setToast: (toast) => set({ toast }),
  focusComposer: (moduleId) =>
    set((state) => ({
      composerFocusRequest: state.composerFocusRequest + 1,
      composerModuleId: moduleId === undefined ? state.composerModuleId : moduleId,
    })),
  setComposerModule: (composerModuleId) => set({ composerModuleId }),
}));

/** Invokes a main-process action and shows its error as a toast. */
export async function act<K extends ActionName>(action: K, payload: ActionPayload<K>): Promise<ActionResult<K> | undefined> {
  try {
    return await window.trama.invoke(action, payload);
  } catch (error) {
    const message = (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");
    useUi.getState().setToast(message);
    return undefined;
  }
}
