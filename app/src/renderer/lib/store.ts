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
  | { kind: "issues" }
  | { kind: "issue"; number: number };

export type DialogName = "settings" | "connections" | "createProject" | null;

interface UiState {
  app: AppState | null;
  sidebarOpen: boolean;
  inspector: InspectorTarget | null;
  dialog: DialogName;
  toast: string | null;
  composerFocusRequest: number;
  composerModuleId: string | null;
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
  setApp: (app) => {
    const previous = get().app;
    // A different project resets the panels that point into the old one.
    if (previous?.project?.id !== app.project?.id) set({ inspector: null, composerModuleId: null });
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
  setInspector: (inspector) => set({ inspector }),
  toggleInspector: (target) => {
    const current = get().inspector;
    set({ inspector: current && current.kind === target.kind ? null : target });
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
