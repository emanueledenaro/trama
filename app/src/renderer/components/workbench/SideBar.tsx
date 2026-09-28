import { IconArrowNarrowLeft, IconArrowsDiagonal, IconArrowsDiagonalMinimize2, IconX } from "@tabler/icons-react";
import { InspectorBody, InspectorTitle, targetTitle } from "@/components/inspector/Inspector";
import { ProjectsView } from "@/components/sidebar/Sidebar";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { type InspectorTarget, useUi } from "@/lib/store";
import { TAB_LABELS, VIEW_LABELS, VIEW_TABS, homeOf, isDetail, tabOf, viewOf } from "@/lib/workbench";

const HEADER_BUTTON = "sidebar-icon-button no-drag size-6 rounded-md";

/** The side bar's width controls, owned by the window so the sash on the editor's edge can share them. */
export interface SideBarWidth {
  width: number;
  max: number;
  widen(): void;
  reset(): void;
  resizing: boolean;
}

/**
 * The side bar (issue #330): the view chosen in the activity bar, one at a time, attached to the activity bar. Until
 * the slices B02-B08 build the new views, a view lists the panels of today as tabs; a detail (a module, a candidate,
 * a person of the team) opens in the same place with a way back.
 */
export function SideBar({ size }: { size: SideBarWidth }) {
  const t = useT();
  const project = useUi((s) => s.app?.project ?? null);
  const stored = useUi((s) => s.sideBarView);
  const inspector = useUi((s) => s.inspector);
  const setInspector = useUi((s) => s.setInspector);
  const goBack = useUi((s) => s.goBack);
  const canGoBack = useUi((s) => s.historyIndex > 0 && s.history[s.historyIndex - 1] !== null);
  const view = project ? stored : "projects";
  const target: InspectorTarget | null = view === "projects" ? null : inspector && viewOf(inspector) === view ? inspector : homeOf(view);
  const detail = target ? isDetail(target) : false;
  const tabs = view === "projects" ? [] : VIEW_TABS[view];
  const isWide = size.width >= size.max - 8;
  const viewName = t(VIEW_LABELS[view]);
  return (
    <aside
      aria-label={target ? targetTitle(target.kind, t) : viewName}
      data-testid="side-bar"
      data-view={view}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) setInspector(null);
      }}
      className={cn(
        "app-sidebar-surface @container/inspector relative flex h-full shrink-0 flex-col border-r border-[color:var(--app-panel-border)]",
        !size.resizing && "transition-[width] duration-200 ease-out",
      )}
      style={{ width: size.width }}
    >
      <div className="flex h-[35px] shrink-0 items-center gap-1.5 pr-2 pl-4" data-testid="side-bar-header">
        {detail && target ? (
          <>
            <Tooltip label={t("workbench.sideBar.back")}>
              <button
                type="button"
                aria-label={t("workbench.sideBar.back")}
                className={cn(HEADER_BUTTON, "-ml-2")}
                // Back to where the person came from, else to the list the detail belongs to.
                onClick={() => (canGoBack ? goBack() : setInspector({ kind: tabOf(target) } as InspectorTarget))}
              >
                <IconArrowNarrowLeft className="size-4" stroke={1.7} />
              </button>
            </Tooltip>
            <InspectorTitle target={target} />
          </>
        ) : target?.kind === "waiting" ? (
          <InspectorTitle target={target} />
        ) : (
          <h2 className="min-w-0 flex-1 truncate font-system-ui text-ui font-medium text-foreground" data-testid="side-bar-title">
            {viewName}
          </h2>
        )}
        <Tooltip label={isWide ? t("workbench.sideBar.normalWidth") : t("workbench.sideBar.widen")}>
          <button
            type="button"
            aria-label={isWide ? t("workbench.sideBar.normalWidth") : t("workbench.sideBar.widen")}
            aria-pressed={isWide}
            className={HEADER_BUTTON}
            onClick={() => (isWide ? size.reset() : size.widen())}
          >
            {isWide ? <IconArrowsDiagonalMinimize2 className="size-3.5" /> : <IconArrowsDiagonal className="size-3.5" />}
          </button>
        </Tooltip>
        <Tooltip label={t("workbench.sideBar.close")}>
          <button type="button" aria-label={t("workbench.sideBar.close")} className={HEADER_BUTTON} onClick={() => setInspector(null)}>
            <IconX className="size-3.5" />
          </button>
        </Tooltip>
      </div>
      {tabs.length > 1 && target ? (
        <div
          role="tablist"
          aria-label={t("workbench.sideBar.sections", { view: viewName })}
          className="chat-surface-divider flex shrink-0 gap-0.5 overflow-x-auto px-2 pb-1.5 [scrollbar-width:none]"
        >
          {tabs.map((kind) => {
            const selected = tabOf(target) === kind;
            return (
              <button
                key={kind}
                type="button"
                role="tab"
                aria-selected={selected}
                className={cn(
                  "h-6 shrink-0 rounded-md px-2 text-ui-sm transition-colors",
                  selected
                    ? "bg-[var(--sidebar-selected)] text-[var(--sidebar-accent-foreground)]"
                    : "text-muted-foreground hover:bg-[var(--sidebar-accent)] hover:text-foreground",
                )}
                onClick={() => setInspector({ kind } as InspectorTarget)}
              >
                {t(TAB_LABELS[kind]!)}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">{target ? <InspectorBody target={target} /> : <ProjectsView />}</div>
    </aside>
  );
}
