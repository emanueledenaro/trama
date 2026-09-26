import { useEffect, useRef } from "react";
import type { ProviderId } from "@shared/codex";
import { dialogComposer, findGoal } from "@shared/goals";
import { shouldShowWelcomeOnLaunch } from "@shared/onboarding";
import { ChatView } from "@/components/chat/ChatView";
import { Dialogs } from "@/components/Dialogs";
import { Inspector } from "@/components/inspector/Inspector";
import { WelcomeView } from "@/components/launch/WelcomeView";
import { ResizeHandle, useResizableWidth } from "@/lib/resizable";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { Toast } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { act, refreshProject, useUi } from "@/lib/store";

function useThemeClass(theme: "system" | "light" | "dark" | undefined) {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = theme === "dark" || (theme !== "light" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
}

/** The window glass takes the light of the Coordinator's provider in the open dialog, steady. */
function useProviderTheme() {
  const project = useUi((s) => s.app?.project ?? null);
  const goalId = useUi((s) => s.dialogGoalId);
  useEffect(() => {
    const provider: ProviderId | null = project
      ? (dialogComposer(project.document, findGoal(project.document, goalId)?.id ?? null).selectedProvider ??
        project.document.coordinator.threadProvider ??
        "codex")
      : null;
    // The provider's theme (index.css) sets the light, accent, surfaces and primary button of the whole app.
    if (provider) document.documentElement.dataset.provider = provider;
    else delete document.documentElement.dataset.provider;
  }, [project, goalId]);
}

export function App() {
  const app = useUi((s) => s.app);
  useProviderTheme();
  const setApp = useUi((s) => s.setApp);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const inspector = useUi((s) => s.inspector);
  const sidebar = useResizableWidth("trama.sidebarWidth", { initial: 256, min: 208, max: (viewport) => Math.min(440, viewport * 0.35) });
  const mainView = useUi((s) => s.mainView);

  useEffect(() => {
    void window.trama.getState().then(setApp);
    const offState = window.trama.onState(setApp);
    const offMenu = window.trama.onMenu((command) => {
      const ui = useUi.getState();
      if (command === "settings") ui.openSettings("general");
      else if (command === "createProject") ui.setDialog("createProject");
      else if (command === "guide") ui.setDialog("guide");
      else if (command === "welcome") ui.setWelcome("hello");
      else if (command === "exercises") {
        const exercise = ui.exercise ?? "first";
        void act("exercise:start", { exercise }).then(() => useUi.getState().setExercise(exercise));
      }
      else if (command === "toggleSidebar") ui.toggleSidebar();
      // The items below act on the open project; without one they say so instead of doing nothing (W12).
      else if (!ui.app?.project) ui.setToast("Apri o crea un progetto per usare questa voce.", "info");
      else if (command === "focusComposer") ui.focusComposer();
      else if (command === "refreshProject") void refreshProject();
      else if (command === "toggleInspector") ui.setInspector(ui.inspector && ui.mainView === "dialog" ? null : { kind: "map" });
      else if (command.startsWith("inspector:")) {
        ui.setInspector({ kind: command.slice("inspector:".length) as "map" | "pact" | "mandate" | "issues" | "team" | "work" | "group" | "memory" });
      }
    });
    return () => {
      offState();
      offMenu();
    };
  }, [setApp]);

  useEffect(() => {
    if (app) document.documentElement.dataset.platform = app.platform;
  }, [app?.platform]);
  useThemeClass(app?.settings.theme);

  // The welcome shows by itself once, on a first launch with no projects (B02); the guide reopens it (C12).
  const welcomeChecked = useRef(false);
  useEffect(() => {
    if (!app || welcomeChecked.current) return;
    welcomeChecked.current = true;
    if (shouldShowWelcomeOnLaunch(app)) {
      useUi.getState().setWelcome("hello");
      void act("onboarding:update", { shown: true });
    }
  }, [app]);

  // Opening the map or a module in the example project is a step of the first exercise (C13).
  const observed = app?.project?.isDemo ? app.project.document.exercises?.observed : undefined;
  const isDemo = app?.project?.isDemo ?? false;
  useEffect(() => {
    if (!isDemo) return;
    if (inspector?.kind === "map" && !observed?.mapOpened) void act("exercise:observe", { step: "mapOpened" });
    if (inspector?.kind === "module" && !observed?.moduleOpened) void act("exercise:observe", { step: "moduleOpened" });
  }, [inspector, isDemo, observed?.mapOpened, observed?.moduleOpened]);

  if (!app) return null;
  const isMac = app.platform === "darwin";

  return (
    <TooltipProvider delay={500}>
      <div
        className="flex h-svh w-full bg-[var(--app-shell-background)]"
        data-sidebar-state={sidebarOpen ? "expanded" : "collapsed"}
      >
        <div
          className={cn(
            "relative h-svh shrink-0 overflow-hidden",
            !sidebar.resizing && "transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
          )}
          style={{ width: sidebarOpen ? sidebar.width : 0 }}
        >
          <div
            className={cn(
              "app-sidebar-surface absolute inset-y-0 left-0 flex flex-col transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
              !sidebarOpen && "-translate-x-full",
            )}
            style={{ width: sidebar.width }}
          >
            <Sidebar isMac={isMac} />
          </div>
        </div>
        <div className="relative flex h-svh min-h-0 min-w-0 flex-1">
          {sidebarOpen ? (
            <ResizeHandle
              side="right"
              label="Larghezza della barra laterale. Clic per nasconderla"
              width={sidebar.width}
              min={sidebar.bounds.min}
              max={sidebar.bounds.max}
              onResize={sidebar.setWidth}
              onReset={sidebar.reset}
              onClick={() => useUi.getState().toggleSidebar()}
              onDragChange={sidebar.setResizing}
              className="absolute inset-y-0 -left-1 z-20"
            />
          ) : null}
          <main className="chat-content-card @container/main relative z-[15] flex min-w-0 flex-1 overflow-hidden">
            <ChatView isMac={isMac} />
            {inspector && app.project && mainView === "dialog" ? <Inspector /> : null}
          </main>
        </div>
      </div>
      <WelcomeView />
      <Dialogs />
      <Toast />
    </TooltipProvider>
  );
}
