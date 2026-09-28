import { create } from "zustand";
import type { ProviderId } from "@shared/codex";
import type { AppState } from "@shared/domain";
import type { ActionName, ActionPayload, ActionResult } from "@shared/ipc";
import type { ExerciseId, GuideStepId } from "@shared/onboarding";
import { SIDE_BAR_VIEWS, type SideBarView, homeOf, viewOf } from "@/lib/workbench";

export type InspectorTarget =
  | { kind: "map" }
  /** Everything that waits for the person (issue #240); `key` brings one item into view. */
  | { kind: "waiting"; key?: string }
  | { kind: "module"; id: string }
  | { kind: "file"; path: string }
  | { kind: "pact" }
  | { kind: "decision"; id: string }
  /** `change` opens "Cambia il mandato" on the correction form, as the proposal's Correggi does (issue #334). */
  | { kind: "mandate"; change?: "correct" }
  /** The code standard of the open project, in Regole (issue #334). */
  | { kind: "standard" }
  | { kind: "memory" }
  | { kind: "team" }
  | { kind: "specialist"; id: string }
  /** A conversation between agents (W07). */
  | { kind: "agentThread"; id: string }
  | { kind: "candidate"; id: string }
  /** Focus mode on a candidate (F01): the report of one examination. */
  | { kind: "audit"; id: string }
  | { kind: "group" }
  | { kind: "work" }
  /** `work` opens one turn of work with its technical steps (issue #271). */
  | { kind: "activity"; work?: string }
  | { kind: "issues" }
  | { kind: "issue"; number: number }
  /** A pull request, a commit or a branch a message cites (issue #277). */
  | { kind: "pullRequest"; number: number }
  | { kind: "commit"; sha: string }
  | { kind: "branch"; name: string }
  | { kind: "goals"; create?: boolean }
  | { kind: "goal"; id: string; edit?: boolean };

/** The main pane: a dialog with the Coordinator, the projects overview (UX03), or the settings page. */
export type MainView = "dialog" | "overview" | "settings";

/** The sections of the settings page; "connections" holds ChatGPT, GitHub and the providers. */
export type SettingsSection = "general" | "connections" | "method" | "standard" | "learning" | "monitor" | "presence";

export type DialogName = "createProject" | "cloneProject" | "search" | "guide" | null;

/** The welcome (B02): its first page, or one of its configuration steps. */
export type WelcomePage = "hello" | GuideStepId;

interface UiState {
  app: AppState | null;
  /** Whether the side bar is open next to the activity bar (issue #330). */
  sidebarOpen: boolean;
  /** The view of the activity bar the side bar shows. */
  sideBarView: SideBarView;
  /** What the side bar shows inside its view: one of the view's tabs or a detail; null shows the view's first tab. */
  inspector: InspectorTarget | null;
  dialog: DialogName;
  /** The dialog to reopen when the current one closes, for example the guide after Collegamenti. */
  dialogReturn: DialogName;
  /** The exercise shown in the panel over the example project's chat. */
  exercise: ExerciseId | null;
  /** The welcome page shown over the window, null when closed (B02). */
  welcome: WelcomePage | null;
  setWelcome(page: WelcomePage | null): void;
  toast: string | null;
  /** "info" for a plain confirmation, such as a goal archived; errors and warnings keep the default. */
  toastTone: "warning" | "info";
  composerFocusRequest: number;
  composerModuleId: string | null;
  /** A question another view prepared for the composer; the composer takes it once and clears it (W12). */
  composerPrefill: string | null;
  mainView: MainView;
  /** The goal the one chat is filtered on; null shows the whole chat (UX02, U01). */
  dialogGoalId: string | null;
  /** A goal to open once its project is the selected one, after a switch from the overview. */
  pendingGoal: { projectId: string; goalId: string } | null;
  setMainView(view: MainView): void;
  settingsSection: SettingsSection;
  /** The view the settings page returns to when it closes. */
  settingsReturn: Exclude<MainView, "settings">;
  openSettings(section?: SettingsSection): void;
  closeSettings(): void;
  /** Shows the chat filtered on a goal, or the whole chat with null (U01). */
  openDialog(goalId: string | null): void;
  openGoalOf(projectId: string, goalId: string): void;
  /** Inspector history for the back and forward buttons. */
  history: (InspectorTarget | null)[];
  historyIndex: number;
  goBack(): void;
  goForward(): void;
  setApp(state: AppState): void;
  toggleSidebar(): void;
  /** The activity bar: opens a view in the side bar, or closes the side bar when that view is already open. */
  openView(view: SideBarView): void;
  /** Opens a panel in the side bar under its view; null closes the side bar. */
  setInspector(target: InspectorTarget | null): void;
  toggleInspector(target: InspectorTarget): void;
  setDialog(dialog: DialogName, returnTo?: DialogName): void;
  setExercise(exercise: ExerciseId | null): void;
  setToast(message: string | null, tone?: "warning" | "info"): void;
  focusComposer(moduleId?: string | null): void;
  /**
   * "Chiedi al Coordinatore" from a panel: shows the chat (filtered on the goal when `goalId` is given), puts `text` in the
   * composer ready to edit or send, and focuses it. Nothing is sent (W12).
   */
  askCoordinator(text: string, options?: { goalId?: string | null; moduleId?: string | null }): void;
  takeComposerPrefill(): string | null;
  setComposerModule(moduleId: string | null): void;
  /**
   * A recovery action asked the Coordinator's picker to open (P10): on the current provider's models, or on
   * `provider` when the action changes provider. `nonce` changes at each request.
   */
  pickerRequest: { provider: ProviderId | null; nonce: number } | null;
  openModelPicker(provider?: ProviderId | null): void;
}

const readSidebar = () => {
  try {
    // Closed by default: the conversation takes the whole editor area (issue #330).
    return localStorage.getItem("trama.sideBarOpen") === "true";
  } catch {
    return false;
  }
};

const readSideBarView = (): SideBarView => {
  try {
    const saved = localStorage.getItem("trama.sideBarView") as SideBarView | null;
    return saved && SIDE_BAR_VIEWS.includes(saved) ? saved : "waiting";
  } catch {
    return "waiting";
  }
};

const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not remembered; the layout still applies now.
  }
};

/** The side bar's state for a target: open on the target's view, or closed for null. */
const sideBarFor = (target: InspectorTarget | null, view: SideBarView) => {
  const sideBarView = target ? viewOf(target) : view;
  remember("trama.sideBarOpen", String(Boolean(target)));
  remember("trama.sideBarView", sideBarView);
  return { sidebarOpen: Boolean(target), sideBarView };
};

export const useUi = create<UiState>((set, get) => ({
  app: null,
  sidebarOpen: readSidebar(),
  sideBarView: readSideBarView(),
  inspector: null,
  dialog: null,
  dialogReturn: null,
  exercise: null,
  welcome: null,
  setWelcome: (welcome) => set({ welcome }),
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
    if (historyIndex > 0) {
      const inspector = history[historyIndex - 1] ?? null;
      set({ historyIndex: historyIndex - 1, inspector, ...sideBarFor(inspector, get().sideBarView) });
    }
  },
  goForward: () => {
    const { history, historyIndex } = get();
    if (historyIndex < history.length - 1) {
      const inspector = history[historyIndex + 1] ?? null;
      set({ historyIndex: historyIndex + 1, inspector, ...sideBarFor(inspector, get().sideBarView) });
    }
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
    const { sidebarOpen, sideBarView } = get();
    if (sidebarOpen) get().setInspector(null);
    else get().openView(sideBarView);
  },
  openView: (view) => {
    const { sidebarOpen, sideBarView, app } = get();
    // As in VS Code, the icon of the open view closes the side bar.
    if (sidebarOpen && sideBarView === view) return get().setInspector(null);
    // Without a project only the projects can show.
    const shown = app?.project ? view : "projects";
    const home = homeOf(shown);
    if (home) return get().setInspector(home);
    remember("trama.sideBarOpen", "true");
    remember("trama.sideBarView", shown);
    set({ sidebarOpen: true, sideBarView: shown, inspector: null });
  },
  setInspector: (inspector) => {
    const { history, historyIndex, inspector: current, sideBarView } = get();
    // Details belong to a project dialog: opening one leaves the overview.
    if (inspector) set({ mainView: "dialog" });
    // Every panel of today opens in the side bar, under its view (issue #330); null closes the side bar.
    set(sideBarFor(inspector, sideBarView));
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
  pickerRequest: null,
  openModelPicker: (provider = null) =>
    set((state) => ({ pickerRequest: { provider, nonce: (state.pickerRequest?.nonce ?? 0) + 1 }, mainView: "dialog" })),
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
