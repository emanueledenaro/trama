import { useEffect, useRef } from "react";
import type { ProviderId } from "@shared/codex";
import { chatComposer } from "@shared/goals";
import { translator } from "@shared/i18n";
import { isFirstLaunch, welcomeLaunchDecision } from "@shared/onboarding";
import { Dialogs } from "@/components/Dialogs";
import { FocusModeView } from "@/components/focus/FocusModeView";
import { Sash, useResizableHeight, useResizableWidth } from "@/lib/resizable";
import { ActivityBar } from "@/components/workbench/ActivityBar";
import { EditorArea } from "@/components/workbench/EditorArea";
import { ActivityPanel } from "@/components/workbench/ActivityPanel";
import { SideBar } from "@/components/workbench/SideBar";
import { StatusBar } from "@/components/workbench/StatusBar";
import { TitleBar } from "@/components/workbench/TitleBar";
import { Toast } from "@/components/Toast";
import { FilledScope } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useWaiting } from "@/components/WaitingView";
import { cn } from "@/lib/cn";
import { useDocumentLanguage, useT } from "@/lib/i18n";
import { act, refreshProject, useUi } from "@/lib/store";
import { CONVERSATION_TAB, PANEL_MIN_HEIGHT, SIDE_BAR_MIN_WIDTH, SIDE_BAR_VIEWS, SPLIT_EDITOR_MIN_VIEWPORT, type SideBarView, panelDefaultHeight, panelMaxHeight, sideBarDefaultWidth, sideBarMaxWidth } from "@/lib/workbench";

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

/** The accents follow the Coordinator's provider in the project's chat; the surface and the glass stay neutral (issue #457). */
function useProviderTheme() {
  const project = useUi((s) => s.app?.project ?? null);
  useEffect(() => {
    const provider: ProviderId | null = project
      ? (chatComposer(project.document).selectedProvider ?? project.document.coordinator.threadProvider ?? "codex")
      : null;
    // The provider's theme (index.css) sets only the accents of the whole app: accent text, primary button, focus ring, selection.
    if (provider) document.documentElement.dataset.provider = provider;
    else delete document.documentElement.dataset.provider;
  }, [project]);
}

/** A view from the View menu opens in the side bar as from the activity bar, but stays open when it already shows (issue #345). */
function openMenuView(ui: ReturnType<typeof useUi.getState>, view: SideBarView) {
  if (!(ui.sidebarOpen && ui.sideBarView === view)) ui.openView(view);
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
  // While something waits, the window's one filled button is Aspetta te's (issue #338).
  const waiting = useWaiting().length > 0;
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
      else if (command === "welcome") ui.openWelcome();
      else if (command === "exercises") {
        const exercise = ui.exercise ?? "first";
        void act("exercise:start", { exercise }).then(() => {
          useUi.getState().setExercise(exercise);
          useUi.getState().closeWelcome();
        });
      }
      else if (command === "toggleSidebar") ui.toggleSidebar();
      else if (command === "view:projects") openMenuView(ui, "projects");
      // The items below act on the open project; without one they say so instead of doing nothing (W12).
      else if (!ui.app?.project) ui.setToast(translator(ui.app?.language)("menu.needsProject"), "info");
      else if (command === "focusComposer") ui.focusComposer();
      else if (command === "refreshProject") void refreshProject();
      // The conversation's tab comes forward with the composer, as its icon in the activity bar does (issue #336).
      else if (command === "view:conversation") {
        ui.focusTab(CONVERSATION_TAB);
        ui.focusComposer();
      }
      // Activity in the bottom panel, as the title bar's toggle (issue #337).
      else if (command === "togglePanel") ui.togglePanel();
      // The split editor needs a wide window, as the title bar's toggle that only shows there (issue #336).
      else if (command === "toggleSplitEditor") {
        if (window.innerWidth >= SPLIT_EDITOR_MIN_VIEWPORT) ui.toggleSplitEditor();
        else ui.setToast(translator(ui.app?.language)("menu.splitNeedsWidth"), "info");
      }
      else if (command.startsWith("view:")) {
        const view = command.slice("view:".length) as SideBarView;
        if (SIDE_BAR_VIEWS.includes(view)) openMenuView(ui, view);
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

  // The Benvenuto (issue #354). Nothing is decided on the state the window gets before Trama read its settings and
  // recent projects: that state is empty, and deciding on it showed the Benvenuto again with every step done.
  // On the first launch the mark weaves in at its head, once. With a project open it opens by itself only when no
  // provider is connected, once per project opened, on the provider step; the optional steps never reopen it.
  const firstLaunchChecked = useRef(false);
  const launchDecided = useRef<string | null>(null);
  useEffect(() => {
    if (!app?.started) return;
    if (!firstLaunchChecked.current) {
      firstLaunchChecked.current = true;
      if (isFirstLaunch(app)) {
        useUi.getState().setWelcomeIntro(true);
        void act("onboarding:update", { shown: true });
      }
    }
    const projectId = app.project?.id ?? null;
    if (projectId === null) launchDecided.current = null;
    if (projectId === null || launchDecided.current === projectId) return;
    const decision = welcomeLaunchDecision(app);
    if (decision === "wait") return;
    launchDecided.current = projectId;
    if (decision === "open") useUi.getState().openWelcome("provider");
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
            {/* The frame around the sheet: the gap around it keeps the frame's tint, not the glass behind. */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--app-activitybar-surface)]">
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
                <FilledScope allowed={!waiting}>
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
                </FilledScope>
              ) : null}
            </div>
          </div>
        </div>
        <StatusBar />
      </div>
      <Dialogs />
      <Toast />
    </TooltipProvider>
  );
}
