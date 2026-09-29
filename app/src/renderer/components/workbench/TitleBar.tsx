import {
  IconArrowNarrowLeft,
  IconArrowNarrowRight,
  IconCheck,
  IconChevronDown,
  IconFolderPlus,
  IconGitBranch,
  IconHome,
  IconLayoutBottombar,
  IconLayoutList,
  IconLayoutSidebar,
  IconLayoutSidebarRight,
  IconPencilPlus,
  IconRefresh,
  IconSearch,
} from "@tabler/icons-react";
import { findGoal } from "@shared/goals";
import { TramaMark } from "@/components/brand/TramaMark";
import { HEADER_CHIP, HEADER_CHIP_ACTIVE } from "@/components/chat/ChatView";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { act, refreshProject, useUi } from "@/lib/store";
import { SPLIT_EDITOR_MIN_VIEWPORT } from "@/lib/workbench";
import { useViewportWidth } from "./EditorArea";

const ICON_BUTTON =
  "no-drag inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent aria-pressed:text-foreground";

/** The project's name with the menu of the projects: the recent ones, the overview, open and create. */
function ProjectMenu() {
  const t = useT();
  const app = useUi((s) => s.app)!;
  const project = app.project;
  const setMainView = useUi((s) => s.setMainView);
  const setDialog = useUi((s) => s.setDialog);
  const openDialog = useUi((s) => s.openDialog);
  const openWelcome = useUi((s) => s.openWelcome);
  const goal = useUi((s) => (project ? findGoal(project.document, s.dialogGoalId) : null));
  const name = project ? (project.isDemo ? t("workbench.title.demoProject") : project.name) : t("workbench.title.noProject");
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Menu>
        <MenuTrigger aria-label={t("workbench.title.projectMenu", { name })} className={cn(HEADER_CHIP, "no-drag min-w-0 text-ui text-foreground")}>
          {/* One chat per project (U01): with a goal filter the next crumb names the goal the next message is about. */}
          <span className="min-w-0 truncate" data-testid={goal ? undefined : "dialog-title"}>
            {name}
          </span>
          <IconChevronDown className="size-3 shrink-0 opacity-60" stroke={1.8} />
        </MenuTrigger>
        <MenuPopup align="start">
          {app.recentProjects.map((recent) => (
            <MenuItem
              key={recent.id}
              onClick={() => {
                setMainView("dialog");
                void act("project:open", { path: recent.path });
              }}
            >
              <span className="flex size-4 items-center justify-center">{project?.id === recent.id ? <IconCheck className="size-3.5" stroke={1.8} /> : null}</span>
              <span className="max-w-[18rem] flex-1 truncate" title={recent.path}>
                {recent.name}
              </span>
            </MenuItem>
          ))}
          {app.recentProjects.length ? <MenuSeparator /> : null}
          <MenuItem onClick={() => setMainView("overview")}>
            <IconLayoutList stroke={1.8} />
            {t("workbench.title.overview")}
          </MenuItem>
          <MenuItem onClick={() => void act("project:openDialog", undefined)}>
            <IconFolderPlus stroke={1.8} />
            {t("workbench.title.openProject")}
          </MenuItem>
          <MenuItem onClick={() => setDialog("createProject")}>
            <IconPencilPlus stroke={1.8} />
            {t("workbench.title.createProject")}
          </MenuItem>
          <MenuSeparator />
          {/* The Benvenuto reopens from here and from the Help menu (issue #354). */}
          <MenuItem onClick={() => openWelcome()}>
            <IconHome stroke={1.8} />
            {t("welcome.tab")}
          </MenuItem>
        </MenuPopup>
      </Menu>
      {project && goal ? (
        <>
          <span className="text-muted-foreground/60">›</span>
          <button
            type="button"
            className="no-drag min-w-0 truncate rounded-md px-1 text-ui text-foreground hover:bg-[var(--color-background-button-secondary-hover)]"
            onClick={() => openDialog(null)}
            title={t("workbench.title.wholeChat")}
            data-testid="dialog-title"
          >
            {goal.title}
          </button>
        </>
      ) : null}
      {project?.snapshot.branch ? (
        <span className="hidden min-w-0 items-center gap-1 truncate text-ui-sm text-muted-foreground/70 @min-[900px]/title:flex">
          <IconGitBranch className="size-3.5 shrink-0" stroke={1.7} />
          <span className="truncate">{project.snapshot.branch}</span>
        </span>
      ) : null}
    </div>
  );
}

function NavigationButtons() {
  const t = useT();
  const canGoBack = useUi((s) => s.historyIndex > 0);
  const canGoForward = useUi((s) => s.historyIndex < s.history.length - 1);
  const goBack = useUi((s) => s.goBack);
  const goForward = useUi((s) => s.goForward);
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Tooltip label={t("workbench.title.back")}>
        <button type="button" aria-label={t("workbench.title.back")} disabled={!canGoBack} onClick={goBack} className={ICON_BUTTON}>
          <IconArrowNarrowLeft className="size-[18px]" stroke={1.6} />
        </button>
      </Tooltip>
      <Tooltip label={t("workbench.title.forward")}>
        <button type="button" aria-label={t("workbench.title.forward")} disabled={!canGoForward} onClick={goForward} className={ICON_BUTTON}>
          <IconArrowNarrowRight className="size-[18px]" stroke={1.6} />
        </button>
      </Tooltip>
    </div>
  );
}

/**
 * The title bar (issue #330, ADR 0018), 46 px across the window: Trama's mark, the project with its menu and branch,
 * the search in the middle, and the toggles of the side bar and of the Activity panel. It is the window's drag area.
 */
export function TitleBar({ isMac }: { isMac: boolean }) {
  const t = useT();
  const project = useUi((s) => s.app?.project ?? null);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const activityOpen = useUi((s) => s.panelOpen);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const togglePanel = useUi((s) => s.togglePanel);
  const setDialog = useUi((s) => s.setDialog);
  const splitEditor = useUi((s) => s.splitEditor);
  const toggleSplitEditor = useUi((s) => s.toggleSplitEditor);
  const splitAvailable = useViewportWidth() >= SPLIT_EDITOR_MIN_VIEWPORT;
  const name = project ? (project.isDemo ? t("workbench.title.demoProject") : project.name) : null;
  return (
    <header
      className={cn(
        "@container/title drag-region relative flex h-[46px] shrink-0 items-center gap-2 border-b border-[color:var(--app-panel-border)] bg-[var(--app-activitybar-surface)] pr-2 pl-3 font-system-ui",
        isMac && "desktop-top-bar-traffic-light-gutter",
      )}
      data-testid="title-bar"
    >
      {/* The brand slot (B01): the mark stays here in every screen, in the provider's colors. */}
      <div className="flex size-7 shrink-0 items-center justify-center" data-testid="brand-slot">
        <TramaMark size={18} />
      </div>
      <div className="flex min-w-0 flex-1 basis-0 items-center">
        <ProjectMenu />
      </div>
      <div className="flex min-w-0 shrink items-center gap-1.5">
        <NavigationButtons />
        <button
          type="button"
          aria-label={t("workbench.title.search")}
          onClick={() => setDialog("search")}
          className="no-drag flex h-7 w-[min(360px,30vw)] min-w-9 items-center gap-2 rounded-md border border-[color:var(--border)] bg-[var(--color-background-button-secondary)] px-2.5 text-ui-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <IconSearch className="size-3.5 shrink-0" stroke={1.8} />
          <span className="hidden min-w-0 flex-1 truncate text-left @min-[760px]/title:inline">
            {name ? t("workbench.title.searchIn", { name }) : t("workbench.title.searchTrama")}
          </span>
          <span className="hidden shrink-0 rounded border border-[color:var(--border)] px-1 text-[10px] leading-4 @min-[760px]/title:inline">⌘K</span>
        </button>
      </div>
      <div className="flex min-w-0 flex-1 basis-0 items-center justify-end gap-1">
        {/* The goal filter is in the summary of Lavoro (issue #332); the exercises start from Impara in the Benvenuto (issue #354). */}
        {project ? (
          <Tooltip label={t("workbench.title.refresh")}>
            <button type="button" className={ICON_BUTTON} aria-label={t("workbench.title.refresh")} onClick={() => void refreshProject()}>
              <IconRefresh className="size-4" stroke={1.7} />
            </button>
          </Tooltip>
        ) : null}
        {/* Issue #338: an icon's tooltip is its name, the same words a screen reader reads. */}
        <Tooltip label={t("workbench.sideBar.toggle")}>
          <button type="button" className={cn(ICON_BUTTON, sidebarOpen && HEADER_CHIP_ACTIVE)} aria-label={t("workbench.sideBar.toggle")} aria-pressed={sidebarOpen} onClick={toggleSidebar}>
            <IconLayoutSidebar className="size-4" stroke={1.7} />
          </button>
        </Tooltip>
        {project ? (
          // The bottom panel with Activity (issue #337).
          <Tooltip label={t("workbench.title.panel")}>
            <button
              type="button"
              className={cn(ICON_BUTTON, activityOpen && HEADER_CHIP_ACTIVE)}
              aria-label={t("workbench.title.panel")}
              aria-pressed={activityOpen}
              onClick={togglePanel}
            >
              <IconLayoutBottombar className="size-4" stroke={1.7} />
            </button>
          </Tooltip>
        ) : null}
        {splitAvailable ? (
          // The split editor (issue #336): in a wide window the details sit beside the conversation, or cover it.
          // Its state is aria-pressed; the name stays the same, as the tooltip (issue #338).
          <Tooltip label={t("workbench.editor.split")}>
            <button
              type="button"
              className={cn(ICON_BUTTON, splitEditor && HEADER_CHIP_ACTIVE)}
              aria-label={t("workbench.editor.split")}
              aria-pressed={splitEditor}
              data-testid="split-editor-toggle"
              onClick={toggleSplitEditor}
            >
              <IconLayoutSidebarRight className="size-4" stroke={1.7} />
            </button>
          </Tooltip>
        ) : null}
      </div>
    </header>
  );
}
