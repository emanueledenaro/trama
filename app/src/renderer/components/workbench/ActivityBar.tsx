import { IconBrain, IconFileDiff, IconFolders, IconHourglass, IconSettings, IconShieldCheck, IconUsersGroup } from "@tabler/icons-react";
import type * as React from "react";
import { TramaMark } from "@/components/brand/TramaMark";
import { useWaiting } from "@/components/WaitingView";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { useUi } from "@/lib/store";
import { CONVERSATION_TAB, type SideBarView, VIEW_LABELS } from "@/lib/workbench";
import { useSplitEditor } from "./EditorArea";

function ActivityButton({
  label,
  active,
  onClick,
  badge,
  badgeLabel,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
  badgeLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={badge ? (badgeLabel ?? label) : label} side="right">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        data-active={active || undefined}
        onClick={onClick}
        className={cn(
          "activity-bar-item relative flex h-12 w-12 shrink-0 items-center justify-center text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring",
          active && "text-foreground",
        )}
      >
        {children}
        {badge ? (
          <span
            className="absolute top-2 right-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--app-focus-border,var(--color-text-accent))] px-1 text-[10px] leading-none font-semibold text-white"
            data-testid="activity-badge"
            aria-hidden
          >
            {badge}
          </span>
        ) : null}
      </button>
    </Tooltip>
  );
}

/**
 * The activity bar (issue #330, ADR 0018): a column of icons on the left that chooses what the window shows.
 * Projects on top, then the Coordinator's conversation and the five views of the project, Settings at the bottom. The one badge
 * counts what waits for the person. The icon of the open view closes the side bar, as in VS Code.
 */
export function ActivityBar() {
  const t = useT();
  const project = useUi((s) => s.app?.project ?? null);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const stored = useUi((s) => s.sideBarView);
  const mainView = useUi((s) => s.mainView);
  const openView = useUi((s) => s.openView);
  const focusTab = useUi((s) => s.focusTab);
  // A detail tab covers the main tab in a narrow window, or never when the details sit beside it.
  const split = useSplitEditor();
  const covered = useUi((s) => s.editorFocus === "detail" && s.activeDetail !== null) && !split;
  const openSettings = useUi((s) => s.openSettings);
  const closeSettings = useUi((s) => s.closeSettings);
  const focusComposer = useUi((s) => s.focusComposer);
  const waiting = useWaiting().length;
  const shown = sidebarOpen ? (project ? stored : "projects") : null;
  const view = (key: SideBarView, icon: React.ReactNode, badge?: number) => (
    <ActivityButton
      label={t(VIEW_LABELS[key])}
      active={shown === key}
      onClick={() => openView(key)}
      badge={badge}
      badgeLabel={badge ? t("workbench.view.waitingCount", { count: badge }) : undefined}
    >
      {icon}
    </ActivityButton>
  );
  return (
    <nav
      aria-label={t("workbench.views")}
      data-testid="activity-bar"
      className="flex h-full w-12 shrink-0 flex-col items-center border-r border-[color:var(--app-panel-border)] bg-[var(--app-activitybar-surface)]"
    >
      <ActivityButton label={t("workbench.view.projects")} active={shown === "projects"} onClick={() => openView("projects")}>
        <IconFolders className="size-5" stroke={1.6} />
      </ActivityButton>
      {project ? (
        <>
          <div className="h-1.5" />
          <ActivityButton
            label={t("workbench.view.conversation")}
            active={mainView === "dialog" && !covered && !sidebarOpen}
            onClick={() => {
              // The conversation's tab comes forward; Progetti, Impostazioni and the details keep their tabs (issue #336).
              focusTab(CONVERSATION_TAB);
              focusComposer();
            }}
          >
            {/* Trama's mark in one tint, like the other icons: the conversation is with the Coordinator. */}
            <TramaMark variant="mono" size={20} />
          </ActivityButton>
          {view("waiting", <IconHourglass className="size-5" stroke={1.6} />, waiting)}
          {view("work", <IconFileDiff className="size-5" stroke={1.6} />)}
          {view("teams", <IconUsersGroup className="size-5" stroke={1.6} />)}
          {view("rules", <IconShieldCheck className="size-5" stroke={1.6} />)}
          {view("memory", <IconBrain className="size-5" stroke={1.6} />)}
        </>
      ) : null}
      <span className="flex-1" />
      <ActivityButton
        label={t("workbench.view.settings")}
        active={mainView === "settings" && !covered}
        onClick={() => (mainView === "settings" && !covered ? closeSettings() : openSettings("general"))}
      >
        <IconSettings className="size-5" stroke={1.6} />
      </ActivityButton>
    </nav>
  );
}
