import { useEffect, useRef } from "react";
import { shouldOpenGuideOnLaunch } from "@shared/onboarding";
import { ChatView } from "@/components/chat/ChatView";
import { Dialogs } from "@/components/Dialogs";
import { Inspector } from "@/components/inspector/Inspector";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { Toast } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { act, useUi } from "@/lib/store";

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

export function App() {
  const app = useUi((s) => s.app);
  const setApp = useUi((s) => s.setApp);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const inspector = useUi((s) => s.inspector);
  const mainView = useUi((s) => s.mainView);

  useEffect(() => {
    void window.trama.getState().then(setApp);
    const offState = window.trama.onState(setApp);
    const offMenu = window.trama.onMenu((command) => {
      const ui = useUi.getState();
      if (command === "settings") ui.setDialog("settings");
      else if (command === "createProject") ui.setDialog("createProject");
      else if (command === "guide") ui.setDialog("guide");
      else if (command === "exercises") {
        const exercise = ui.exercise ?? "first";
        void act("exercise:start", { exercise }).then(() => useUi.getState().setExercise(exercise));
      }
      else if (command === "toggleSidebar") ui.toggleSidebar();
      else if (command === "focusComposer") ui.focusComposer();
      else if (command === "toggleInspector") ui.setInspector(ui.inspector ? null : { kind: "map" });
      else if (command.startsWith("inspector:") && ui.app?.project) {
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

  // The guide opens by itself once, on a first launch with no projects (C12).
  const guideChecked = useRef(false);
  useEffect(() => {
    if (!app || guideChecked.current) return;
    guideChecked.current = true;
    if (shouldOpenGuideOnLaunch(app)) {
      useUi.getState().setDialog("guide");
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
            "relative h-svh shrink-0 overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
            sidebarOpen ? "w-64" : "w-0",
          )}
        >
          <div
            className={cn(
              "app-sidebar-surface absolute inset-y-0 left-0 flex w-64 flex-col transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
              !sidebarOpen && "-translate-x-full",
            )}
          >
            <Sidebar isMac={isMac} />
          </div>
        </div>
        <div className="relative flex h-svh min-h-0 min-w-0 flex-1">
          {sidebarOpen ? (
            <button
              type="button"
              aria-label="Nascondi la barra laterale"
              data-placement="content-seam"
              onClick={() => useUi.getState().toggleSidebar()}
              className="absolute inset-y-0 -left-1 z-20 w-2 cursor-ew-resize"
            />
          ) : null}
          <main className="chat-content-card relative z-[15] flex min-w-0 flex-1 overflow-hidden">
            <ChatView isMac={isMac} />
            {inspector && app.project && mainView === "dialog" ? <Inspector /> : null}
          </main>
        </div>
      </div>
      <Dialogs />
      <Toast />
    </TooltipProvider>
  );
}
