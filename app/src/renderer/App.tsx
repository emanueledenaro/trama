import { useEffect, useRef } from "react";
import type { ProviderId } from "@shared/codex";
import { chatComposer } from "@shared/goals";
import { shouldShowWelcomeOnLaunch } from "@shared/onboarding";
import { Dialogs } from "@/components/Dialogs";
import { FocusModeView } from "@/components/focus/FocusModeView";
import { WelcomeView } from "@/components/launch/WelcomeView";
import { Sash, useResizableHeight, useResizableWidth } from "@/lib/resizable";
import { ActivityBar } from "@/components/workbench/ActivityBar";
import { EditorArea } from "@/components/workbench/EditorArea";
import { ActivityPanel } from "@/components/workbench/ActivityPanel";
import { SideBar } from "@/components/workbench/SideBar";
import { StatusBar } from "@/components/workbench/StatusBar";
import { TitleBar } from "@/components/workbench/TitleBar";
import { Toast } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { useDocumentLanguage, useT } from "@/lib/i18n";
import { act, refreshProject, useUi } from "@/lib/store";
import { PANEL_MIN_HEIGHT, SIDE_BAR_MIN_WIDTH, panelDefaultHeight, panelMaxHeight, sideBarDefaultWidth, sideBarMaxWidth } from "@/lib/workbench";

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

/** The window glass takes the light of the Coordinator's provider in the project's chat, steady. */
function useProviderTheme() {
  const project = useUi((s) => s.app?.project ?? null);
  useEffect(() => {
    const provider: ProviderId | null = project
      ? (chatComposer(project.document).selectedProvider ?? project.document.coordinator.threadProvider ?? "codex")
      : null;
    // The provider's theme (index.css) sets the light, accent, surfaces and primary button of the whole app.
    if (provider) document.documentElement.dataset.provider = provider;
    else delete document.documentElement.dataset.provider;
  }, [project]);
}

export function App() {
  const app = useUi((s) => s.app);
  useProviderTheme();
  useDocumentLanguage();
  const setApp = useUi((s) => s.setApp);
  const t = useT();
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const inspector = useUi((s) => s.inspector);
  // A module opens in an editor tab (issue #336): the exercise still sees it opened.
  const openedModule = useUi((s) => s.editorFocus === "detail" && (s.activeDetail?.startsWith("detail:module:") ?? false));
  // The side bar: 300 px, 340 from a 1500 px window, remembered; the chat keeps 420 px beside it (issue #330).
  const sidebar = useResizableWidth("trama.sideBarWidth", { initial: sideBarDefaultWidth, min: SIDE_BAR_MIN_WIDTH, max: sideBarMaxWidth });
  const welcomeOpen = useUi((s) => s.welcome !== null);
  // The bottom panel with Activity: 200 px, 260 from a 1500 px wide window, remembered; the editor keeps its height above (issue #337).
  const panelOpen = useUi((s) => s.panelOpen && Boolean(s.app?.project));
  const panel = useResizableHeight("trama.panelHeight", {
    initial: () => panelDefaultHeight(window.innerWidth),
    min: PANEL_MIN_HEIGHT,
    max: panelMaxHeight,
  });

  useEffect(() => {
    void window.trama.getState().then(setApp);
    const offState = window.trama.onState(setApp);
    const offMenu = window.trama.onMenu((command) => {
      const ui = useUi.getState();
      if (command === "settings") ui.openSettings("general");
      else if (command === "about") {
        // Informazioni su Trama on Windows and Linux: the last group of the general settings, brought into view.
        ui.openSettings("general");
        requestAnimationFrame(() => document.querySelector('[data-testid="about-trama"]')?.scrollIntoView({ block: "center" }));
      }
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
      else if (command === "toggleInspector") ui.setInspector(ui.sidebarOpen && ui.mainView === "dialog" ? null : { kind: "map" });
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
    if ((inspector?.kind === "module" || openedModule) && !observed?.moduleOpened) void act("exercise:observe", { step: "moduleOpened" });
  }, [inspector, openedModule, isDemo, observed?.mapOpened, observed?.moduleOpened]);

  if (!app) return null;
  const isMac = app.platform === "darwin";
  // Full-screen focus mode (F03) takes the whole window for the project on screen, until the person leaves it.
  const inFocus = app.project !== null && app.focusMode?.projectId === app.project.id;

  return (
    <TooltipProvider delay={500}>
      <div
        className="flex h-svh w-full flex-col bg-[var(--app-shell-background)]"
        data-sidebar-state={sidebarOpen ? "expanded" : "collapsed"}
        data-testid="workbench"
        // Behind the welcome the window is inert, even when the focus was not yet inside it (B02).
        inert={welcomeOpen}
      >
        <TitleBar isMac={isMac} />
        <div className="flex min-h-0 flex-1">
          <ActivityBar />
          {sidebarOpen ? (
            <SideBar
              size={{
                width: sidebar.width,
                max: sidebar.bounds.max,
                widen: () => sidebar.setWidth(sidebar.bounds.max),
                reset: sidebar.reset,
                resizing: sidebar.resizing,
              }}
            />
          ) : null}
          <div className="relative flex min-h-0 min-w-0 flex-1">
            {sidebarOpen ? (
              <Sash
                side="right"
                label={t("workbench.sideBar.resize")}
                size={sidebar.width}
                min={sidebar.bounds.min}
                max={sidebar.bounds.max}
                onResize={sidebar.setWidth}
                onReset={sidebar.reset}
                onClick={() => useUi.getState().toggleSidebar()}
                onDragChange={sidebar.setResizing}
              />
            ) : null}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              {inFocus ? (
                // Full-screen focus mode on a module or the project (F03) takes the editor area, tabs included, inside the
                // window's bars and above the bottom panel, until the person leaves it.
                <main className="chat-content-card @container/main relative z-[15] flex min-h-0 min-w-0 flex-1 overflow-hidden">
                  <FocusModeView />
                </main>
              ) : (
                <EditorArea />
              )}
              {panelOpen ? (
                <ActivityPanel
                  size={{
                    height: panel.height,
                    min: panel.bounds.min,
                    max: panel.bounds.max,
                    setHeight: panel.setHeight,
                    reset: panel.reset,
                    resizing: panel.resizing,
                    setResizing: panel.setResizing,
                  }}
                />
              ) : null}
            </div>
          </div>
        </div>
        <StatusBar />
      </div>
      <WelcomeView />
      <Dialogs />
      <Toast />
    </TooltipProvider>
  );
}
