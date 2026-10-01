// Derived from third-party MIT code; see THIRD_PARTY_NOTICES.md.
import {
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconLayoutList,
  IconTarget,
  IconMessageCircle,
  IconX,
  IconPencilPlus,
  IconArchive,
  IconTrash,
} from "@tabler/icons-react";
import { agentInCloud } from "@shared/workPlace";
import { DeleteGoalDialog, setArchived } from "@/components/inspector/GoalsView";
import { StatusDot } from "@/components/inspector/TeamView";
import { AgentAvatar, AgentTag } from "@/components/AgentIdentity";
import { useState } from "react";
import type * as React from "react";
import { Spinner } from "@/components/Spinner";
import { type ProjectGoal, type Specialist } from "@shared/domain";
import { goalDialogIsEmpty, workingGoals } from "@shared/goals";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";
import { useWaiting } from "@/components/WaitingView";

/** Row styling shared by every sidebar row. */
export const SIDEBAR_ROW =
  "flex w-full min-w-0 cursor-pointer items-center text-left select-none h-7 min-h-7 gap-2 rounded-md px-2 py-0.5 text-ui font-normal outline-hidden transition-colors focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring";
const ROW_IDLE = "text-foreground/89 hover:bg-[var(--sidebar-accent)] hover:text-[var(--sidebar-accent-foreground)]";
const ROW_ACTIVE = "bg-[var(--sidebar-selected)] text-[var(--sidebar-accent-foreground)]";

function LeadingIcon({ children }: { children: React.ReactNode }) {
  return <span className="relative inline-flex size-4 shrink-0 items-center justify-center text-foreground/95">{children}</span>;
}

function SidebarRow({
  icon,
  label,
  active,
  onClick,
  badge,
  count,
  trailing,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  /** Things that wait for the person: a tinted chip. */
  badge?: number;
  /** A plain quantity, nothing to do (open issues, work going on): quiet text (issue #272). */
  count?: number;
  trailing?: React.ReactNode;
  className?: string;
}) {
  return (
    <button type="button" onClick={onClick} className={cn(SIDEBAR_ROW, active ? ROW_ACTIVE : ROW_IDLE, className)}>
      <LeadingIcon>{icon}</LeadingIcon>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? (
        <span
          className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-md bg-info/12 px-1 text-ui-xs font-medium text-info-foreground dark:bg-info/20"
          data-testid="sidebar-todo"
        >
          {badge}
        </span>
      ) : count ? (
        <span className="ml-auto px-1 text-ui-xs tabular-nums text-muted-foreground/70" data-testid="sidebar-count">
          {count}
        </span>
      ) : null}
      {trailing}
    </button>
  );
}

function SectionHeader({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <div className="group/project-header relative my-1">
      <div className="flex h-7 w-full min-w-0 items-center px-2 py-0.5 pr-[4.75rem] text-ui font-normal text-muted-foreground/58">
        <span className="truncate">{label}</span>
      </div>
      {children ? (
        // Always in view: the person finds how to create a project without hovering (person's note, 1 October 2026).
        <div className="absolute top-1 right-1.5 flex items-center gap-1.5">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The Projects view of the side bar (issue #330): the overview, the recent projects and, under the open one, its chat,
 * its goals and its agents. The views of the project moved to the activity bar.
 */
export function ProjectsView() {
  const t = useT();
  const app = useUi((s) => s.app)!;
  // The person of the team shown in the editor (issue #336) is the one marked in the list.
  const shownDetail = useUi((s) => s.activeDetail);
  const setInspector = useUi((s) => s.setInspector);
  const setDialog = useUi((s) => s.setDialog);
  const project = app.project;
  const waiting = useWaiting().length;
  const document = project?.document;
  const specialists = sidebarSpecialists(document?.team.specialists ?? []);
  const running = Boolean(project?.runningRequestId) || project?.phase.kind === "studying" || project?.phase.kind === "opening";
  const mainView = useUi((s) => s.mainView);
  const setMainView = useUi((s) => s.setMainView);
  const dialogGoalId = useUi((s) => s.dialogGoalId);
  const openDialog = useUi((s) => s.openDialog);
  // Archived, achieved and abandoned goals leave the sidebar; the goals panel still lists them (W03).
  const goals = document ? workingGoals(document) : [];
  const [deleting, setDeleting] = useState<ProjectGoal | null>(null);
  const runningGoalId = project?.runningRequestId ? (document?.requests.find((r) => r.id === project.runningRequestId)?.goalId ?? null) : null;

  return (
    <div className="flex h-full min-h-0 flex-col text-foreground">
      <div className="min-h-0 flex-1">
        <div className="flex flex-col gap-0.5 px-2 pt-1">
          <SidebarRow
            icon={<IconLayoutList className="size-3.5" stroke={1.8} />}
            label={t("workbench.title.overview")}
            active={mainView === "overview"}
            onClick={() => setMainView(mainView === "overview" ? "dialog" : "overview")}
          />
          <SidebarRow
            icon={<IconFolderPlus className="size-3.5" stroke={1.8} />}
            label={t("workbench.title.openProject")}
            onClick={() => void act("project:openDialog", undefined)}
          />
        </div>

        <div className="px-2 pb-2">
          <SectionHeader label="Progetti">
            <Tooltip label="Crea un progetto">
              <button type="button" className="sidebar-icon-button size-5" aria-label="Crea un progetto" onClick={() => setDialog("createProject")}>
                <IconPencilPlus className="size-3.5" stroke={1.8} />
              </button>
            </Tooltip>
          </SectionHeader>
          <div className="flex flex-col gap-0.5">
            {app.recentProjects.length === 0 ? (
              <p className="px-2 py-1 text-ui-sm text-muted-foreground/60">Nessun progetto recente.</p>
            ) : null}
            {app.recentProjects.map((recent) => {
              const open = project?.id === recent.id;
              const loading = app.loadingProject === recent.path;
              const background = app.backgroundProjects.find((b) => b.id === recent.id);
              return (
                <div key={recent.id}>
                  <div className="group/thread-row relative">
                    <button
                      type="button"
                      onClick={() => {
                        setMainView("dialog");
                        void act("project:open", { path: recent.path });
                      }}
                      title={recent.path}
                      // The open project has no button on the right, so its counter sits in the column of its rows' signs.
                      className={cn(SIDEBAR_ROW, !open && "pr-8", "hover:bg-[var(--sidebar-accent)]", open ? "text-foreground" : "text-foreground/89")}
                    >
                      <LeadingIcon>
                        {open ? <IconFolderOpen className="size-4" stroke={1.6} /> : <IconFolder className="size-4" stroke={1.6} />}
                      </LeadingIcon>
                      <span className="min-w-0 flex-1 truncate font-system-ui text-ui font-normal text-foreground/95">{recent.name}</span>
                      {open && waiting ? (
                        // The one counter of the window is Aspetta te's (issue #331), here on the open project too.
                        <span className="flex w-[15px] shrink-0 items-center justify-center">
                          <span
                            className="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-md bg-info/12 px-1 text-ui-xs font-medium text-info-foreground dark:bg-info/20"
                            aria-label={t("workbench.view.waitingCount", { count: waiting })}
                            title={t("workbench.view.waitingCount", { count: waiting })}
                            data-testid="project-waiting-count"
                          >
                            {waiting}
                          </span>
                        </span>
                      ) : null}
                      {background ? (
                        <span
                          className="shrink-0 text-ui-xs text-muted-foreground"
                          title={`${background.runningAssignments} incarichi in corso${background.pendingDecisions ? `, ${background.pendingDecisions} decisioni da prendere` : ""}`}
                        >
                          {background.runningAssignments} al lavoro
                        </span>
                      ) : null}
                    </button>
                    <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center">
                      {loading || background ? (
                        <Spinner />
                      ) : !open ? (
                        <button
                          type="button"
                          aria-label={`Togli ${recent.name} dai recenti`}
                          onClick={() => void act("project:forgetRecent", { id: recent.id })}
                          className="sidebar-icon-button size-5 opacity-0 group-hover/thread-row:opacity-100"
                        >
                          <IconX className="size-3" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {open && project ? (
                    // Under the project only the one chat, its goal filters and the agents' cards (U01). Questions and
                    // decisions wait in "Aspetta te" and in the Patto, not here.
                    <div className="flex flex-col gap-0.5 pt-0.5" data-testid="sidebar-project-rows">
                      <button
                        type="button"
                        data-testid="sidebar-chat"
                        onClick={() => openDialog(null)}
                        className={cn(SIDEBAR_ROW, "relative pl-8", mainView === "dialog" && !dialogGoalId ? ROW_ACTIVE : ROW_IDLE)}
                      >
                        <IconMessageCircle className="size-3 shrink-0 text-muted-foreground" stroke={1.8} />
                        <span className="min-w-0 flex-1 truncate text-ui leading-5">Chat del Coordinatore</span>
                        <span className="flex w-[15px] shrink-0 items-center justify-center">
                          {running ? <Spinner /> : null}
                        </span>
                      </button>
                      {goals.map((goal) => {
                        const busy = running && runningGoalId === goal.id;
                        const empty = document ? goalDialogIsEmpty(document, goal.id) : false;
                        return (
                          <div key={goal.id} className="group/goal-row relative" data-testid="sidebar-goal">
                            <button
                              type="button"
                              onClick={() => openDialog(goal.id)}
                              title={goal.outcome}
                              className={cn(
                                SIDEBAR_ROW,
                                "pl-8",
                                !busy && (empty ? "group-hover/goal-row:pr-12" : "group-hover/goal-row:pr-7"),
                                mainView === "dialog" && dialogGoalId === goal.id ? ROW_ACTIVE : ROW_IDLE,
                              )}
                            >
                              <IconTarget className="size-3 shrink-0 text-muted-foreground" stroke={1.8} />
                              <span className="min-w-0 flex-1 truncate text-ui leading-5 text-foreground/95">{goal.title}</span>
                              <span className="flex w-[15px] shrink-0 items-center justify-center group-focus-within/goal-row:invisible group-hover/goal-row:invisible">
                                {busy ? (
                                  <Spinner />
                                ) : goal.status === "proposed" ? (
                                  <span className="size-[7px] rounded-full bg-warning" title="Proposto dal Coordinatore" />
                                ) : null}
                              </span>
                            </button>
                            {busy ? null : (
                              // Archive always; delete only while the goal has no history in the chat.
                              <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover/goal-row:opacity-100 focus-within:opacity-100">
                                {empty ? (
                                  <Tooltip label="Elimina l'obiettivo vuoto">
                                    <button
                                      type="button"
                                      aria-label={`Elimina l'obiettivo vuoto ${goal.title}`}
                                      className="sidebar-icon-button size-5"
                                      onClick={() => setDeleting(goal)}
                                    >
                                      <IconTrash className="size-3" />
                                    </button>
                                  </Tooltip>
                                ) : null}
                                <Tooltip label="Archivia l'obiettivo">
                                  <button
                                    type="button"
                                    aria-label={`Archivia ${goal.title}`}
                                    className="sidebar-icon-button size-5"
                                    onClick={() => setArchived(goal, true)}
                                  >
                                    <IconArchive className="size-3" />
                                  </button>
                                </Tooltip>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {specialists.map((specialist) => (
                        <button
                          key={specialist.id}
                          type="button"
                          data-testid="sidebar-agent"
                          onClick={() => setInspector({ kind: "specialist", id: specialist.id })}
                          className={cn(SIDEBAR_ROW, "pl-8", shownDetail === `detail:specialist:${specialist.id}` ? ROW_ACTIVE : ROW_IDLE)}
                        >
                          <AgentAvatar agent={specialist} size={24} className="-my-1 -ml-1" />
                          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-ui leading-5 text-foreground/95">
                            <span className="min-w-0 truncate">{specialist.name}</span>
                            <AgentTag agent={specialist} className="shrink-0" />
                          </span>
                          <span className="flex w-[15px] shrink-0 items-center justify-center">
                            <StatusDot status={specialist.status} cloud={agentInCloud(specialist)} />
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <DeleteGoalDialog goal={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

/**
 * The team members listed under the open project: the developers, then a fixed role only while it has work to show,
 * so eleven idle figures do not push the goals down. The Team panel shows everyone (W09).
 */
export function sidebarSpecialists(specialists: Specialist[]): Specialist[] {
  const members = specialists.filter((s) => s.status !== "removed");
  return [...members.filter((s) => s.role === "developer"), ...members.filter((s) => s.role !== "developer" && s.status !== "available")];
}
