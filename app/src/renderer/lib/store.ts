import { create } from "zustand";
import type { AppState } from "@shared/domain";
import type { ActionName, ActionPayload, ActionResult } from "@shared/ipc";
import type { ExerciseId } from "@shared/onboarding";

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
  | { kind: "goal"; id: string; edit?: boolean };

/** The main pane: a dialog with the Coordinator, the projects overview (UX03), or the settings page. */
export type MainView = "dialog" | "overview" | "settings";

/** The sections of the settings page; "connections" holds ChatGPT, GitHub and the providers. */
export type SettingsSection = "general" | "connections" | "method" | "learning" | "monitor" | "presence";

export type DialogName = "createProject" | "search" | "guide" | null;

interface UiState {
  app: AppState | null;
  sidebarOpen: boolean;
  inspector: InspectorTarget | null;
  dialog: DialogName;
  /** The dialog to reopen when the current one closes, for example the guide after Collegamenti. */
  dialogReturn: DialogName;
  /** The exercise shown in the panel over the example project's chat. */
  exercise: ExerciseId | null;
  toast: string | null;
  /** "info" for a plain confirmation, such as a goal archived; errors and warnings keep the default. */
  toastTone: "warning" | "info";
  composerFocusRequest: number;
  composerModuleId: string | null;
  /** A question another view prepared for the composer; the composer takes it once and clears it (W12). */
  composerPrefill: string | null;
  mainView: MainView;
  /** The goal whose dialog is shown; null is the project dialog (UX02). */
  dialogGoalId: string | null;
  /** A goal to open once its project is the selected one, after a switch from the overview. */
  pendingGoal: { projectId: string; goalId: string } | null;
  setMainView(view: MainView): void;
  settingsSection: SettingsSection;
  /** The view the settings page returns to when it closes. */
  settingsReturn: Exclude<MainView, "settings">;
  openSettings(section?: SettingsSection): void;
  closeSettings(): void;
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
  setDialog(dialog: DialogName, returnTo?: DialogName): void;
  setExercise(exercise: ExerciseId | null): void;
  setToast(message: string | null, tone?: "warning" | "info"): void;
  focusComposer(moduleId?: string | null): void;
  /**
   * "Chiedi al Coordinatore" from a panel: shows the dialog (a goal's when `goalId` is given), puts `text` in the
   * composer ready to edit or send, and focuses it. Nothing is sent (W12).
   */
  askCoordinator(text: string, options?: { goalId?: string | null; moduleId?: string | null }): void;
  takeComposerPrefill(): string | null;
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
  dialogReturn: null,
  exercise: null,
  toast: null,
  toastTone: "warning",
  composerFocusRequest: 0,
  composerModuleId: null,
  composerPrefill: null,
  mainView: "dialog",
  dialogGoalId: null,
  pendingGoal: null,
  setMainView: (mainView) => set({ mainView }),
  settingsSection: "general",
  settingsReturn: "dialog",
  openSettings: (section) => {
    const current = get().mainView;
    set({
      mainView: "settings",
      settingsSection: section ?? get().settingsSection,
      settingsReturn: current === "settings" ? get().settingsReturn : current,
    });
  },
  closeSettings: () => set({ mainView: get().settingsReturn }),
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
      set({ inspector: null, composerModuleId: null, composerPrefill: null, history: [null], historyIndex: 0, dialogGoalId: goal, pendingGoal: goal ? null : pending });
      // A project opened from the settings, the overview or the menu shows its dialog, not the page left behind (W12).
      if (app.project && previous) set({ mainView: "dialog" });
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
  setDialog: (dialog, returnTo = null) => {
    const back = get().dialogReturn;
    if (dialog === null && back) set({ dialog: back, dialogReturn: null });
    else set({ dialog, dialogReturn: returnTo });
  },
  setExercise: (exercise) => set({ exercise }),
  setToast: (toast, toastTone = "warning") => set({ toast, toastTone }),
  // The composer lives in the dialog: from the overview or the settings, writing to the Coordinator goes back to it.
  focusComposer: (moduleId) =>
    set((state) => ({
      composerFocusRequest: state.composerFocusRequest + 1,
      composerModuleId: moduleId === undefined ? state.composerModuleId : moduleId,
      mainView: state.app?.project ? "dialog" : state.mainView,
    })),
  askCoordinator: (text, options = {}) =>
    set((state) => ({
      composerPrefill: text,
      composerFocusRequest: state.composerFocusRequest + 1,
      composerModuleId: options.moduleId === undefined ? state.composerModuleId : options.moduleId,
      dialogGoalId: options.goalId === undefined ? state.dialogGoalId : options.goalId,
      mainView: "dialog",
    })),
  takeComposerPrefill: () => {
    const text = get().composerPrefill;
    if (text !== null) set({ composerPrefill: null });
    return text;
  },
  setComposerModule: (composerModuleId) => set({ composerModuleId }),
}));

/** The main process's error without Electron's IPC prefix. */
export const errorText = (error: unknown) => (error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

/** Invokes a main-process action and shows its error as a toast. */
export async function act<K extends ActionName>(action: K, payload: ActionPayload<K>): Promise<ActionResult<K> | undefined> {
  try {
    return await window.trama.invoke(action, payload);
  } catch (error) {
    useUi.getState().setToast(errorText(error));
    return undefined;
  }
}

/** Rescans the open project; a rescan that changes nothing still says it ran (W12). */
export async function refreshProject(): Promise<void> {
  if (!useUi.getState().app?.project) return;
  try {
    await window.trama.invoke("project:refresh", undefined);
    useUi.getState().setToast("Progetto riletto: mappa e moduli aggiornati.", "info");
  } catch (error) {
    useUi.getState().setToast(errorText(error));
  }
}
