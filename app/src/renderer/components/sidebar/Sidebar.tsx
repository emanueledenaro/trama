// Layout and classes follow Synara (github.com/Emanuele-web04/synara, MIT License, Copyright (c) 2026 T3 Tools Inc. and Emanuele Di Pietro).
import {
  IconCircleDot,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconArrowNarrowLeft,
  IconArrowNarrowRight,
  IconFileDiff,
  IconSearch,
  IconGitPullRequest,
  IconLayoutList,
  IconLayoutSidebar,
  IconTarget,
  IconMessageCircle,
  IconRosetteDiscountCheck,
  IconSettings,
  IconShieldCheck,
  IconSitemap,
  IconUsersGroup,
  IconX,
  IconListCheck,
  IconBrain,
  IconPencilPlus,
  IconArchive,
  IconTrash,
} from "@tabler/icons-react";
import { DeleteGoalDialog, setArchived } from "@/components/inspector/GoalsView";
import { StatusDot } from "@/components/inspector/TeamView";
import { AgentAvatar, AgentTag } from "@/components/AgentIdentity";
import { useState } from "react";
import type * as React from "react";
import { Spinner } from "@/components/Spinner";
import { isOpenQuestion, pendingMandateRequest, type ProjectGoal, type Specialist } from "@shared/domain";
import { goalDialogIsEmpty, workingGoals } from "@shared/goals";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { act, type InspectorTarget, useUi } from "@/lib/store";

/** Row styling shared by every sidebar row, as in Synara's sidebarRowStyles. */
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
  trailing,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick: () => void;
  badge?: number;
  trailing?: React.ReactNode;
  className?: string;
}) {
  return (
    <button type="button" onClick={onClick} className={cn(SIDEBAR_ROW, active ? ROW_ACTIVE : ROW_IDLE, className)}>
      <LeadingIcon>{icon}</LeadingIcon>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? (
        <span className="ml-auto inline-flex h-4 min-w-4 items-center justify-center rounded-md bg-muted px-1 text-ui-xs font-medium text-muted-foreground">
          {badge}
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
        <div className="absolute top-1 right-1.5 flex items-center gap-1.5 opacity-0 transition-opacity group-hover/project-header:opacity-100 focus-within:opacity-100">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function SidebarTrigger({ className }: { className?: string }) {
  const toggle = useUi((s) => s.toggleSidebar);
  return (
    <Tooltip label="Barra laterale">
      <button
        type="button"
        onClick={toggle}
        aria-label="Mostra o nascondi la barra laterale"
        className={cn(
          "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground/75 transition-colors hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground",
          className,
        )}
      >
        <IconLayoutSidebar className="size-4" stroke={1.7} />
      </button>
    </Tooltip>
  );
}

export function NavigationButtons() {
  const canGoBack = useUi((s) => s.historyIndex > 0);
  const canGoForward = useUi((s) => s.historyIndex < s.history.length - 1);
  const goBack = useUi((s) => s.goBack);
  const goForward = useUi((s) => s.goForward);
  const button =
    "inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground/75 transition-colors hover:bg-[var(--color-background-button-secondary-hover)] hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <div className="no-drag flex shrink-0 items-center gap-0.5">
      <Tooltip label="Indietro">
        <button type="button" aria-label="Indietro" disabled={!canGoBack} onClick={goBack} className={button}>
          <IconArrowNarrowLeft className="size-[18px]" stroke={1.6} />
        </button>
      </Tooltip>
      <Tooltip label="Avanti">
        <button type="button" aria-label="Avanti" disabled={!canGoForward} onClick={goForward} className={button}>
          <IconArrowNarrowRight className="size-[18px]" stroke={1.6} />
        </button>
      </Tooltip>
    </div>
  );
}

export function Sidebar({ isMac }: { isMac: boolean }) {
  const app = useUi((s) => s.app)!;
  const inspector = useUi((s) => s.inspector);
  const setInspector = useUi((s) => s.setInspector);
  const setDialog = useUi((s) => s.setDialog);
  const project = app.project;
  const document = project?.document;
  const pendingDecisions = document?.decisionRequests.filter(isOpenQuestion) ?? [];
  // A grilling round is one row with its count, not one row per question.
  const pendingRows = sidebarDecisionRows(pendingDecisions);
  const pendingMandate = document ? pendingMandateRequest(document) : null;
  const openIssues = project?.github.issues.filter((i) => i.state === "open").length ?? 0;
  const pendingTeam = document?.team.proposals.some((p) => !p.resolution) ?? false;
  const activeWork = document?.team.specialists.filter((s) => s.status === "working" || s.status === "stopping").length ?? 0;
  const verifiedCandidates = project ? Object.values(project.candidateReports).filter((r) => r.state !== "building").length : 0;
  const specialists = sidebarSpecialists(document?.team.specialists ?? []);
  const running = Boolean(project?.runningRequestId) || project?.phase.kind === "studying" || project?.phase.kind === "opening";
  const isActive = (kind: InspectorTarget["kind"]) => inspector?.kind === kind;
  const mainView = useUi((s) => s.mainView);
  const setMainView = useUi((s) => s.setMainView);
  const openSettings = useUi((s) => s.openSettings);
  const closeSettings = useUi((s) => s.closeSettings);
  const dialogGoalId = useUi((s) => s.dialogGoalId);
  const openDialog = useUi((s) => s.openDialog);
  // Archived, achieved and abandoned goals leave the sidebar; the goals panel still lists them (W03).
  const goals = document ? workingGoals(document) : [];
  const [deleting, setDeleting] = useState<ProjectGoal | null>(null);
  const runningGoalId = project?.runningRequestId ? (document?.requests.find((r) => r.id === project.runningRequestId)?.goalId ?? null) : null;
  const proposedGoals = goals.filter((g) => g.status === "proposed").length;

  return (
    <div className="flex h-full min-h-0 flex-col text-foreground">
      <div className={cn("sidebar-top-bar drag-region flex h-[46px] shrink-0 flex-row items-center gap-2 py-0 ps-4 pe-3 font-system-ui", isMac && "desktop-top-bar-traffic-light-gutter")}>
        <div className="flex shrink-0 items-center gap-0.5">
          <SidebarTrigger />
          <NavigationButtons />
        </div>
      </div>

      <div className="flex items-center gap-1 pt-0 pr-3 pb-1 pl-1.5">
        <div className="flex h-8 min-w-0 items-center gap-1.5 rounded-lg px-2.5">
          <span className="min-w-0 truncate font-display text-[17px] text-foreground">Trama</span>
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Tooltip label="Cerca (⌘K)">
            <button type="button" className="sidebar-icon-button size-6 rounded-md" aria-label="Cerca" onClick={() => setDialog("search")}>
              <IconSearch className="size-[15px]" stroke={1.7} />
            </button>
          </Tooltip>
          <Tooltip label="Apri progetto">
            <button type="button" className="sidebar-icon-button size-6 rounded-md" aria-label="Apri progetto" onClick={() => void act("project:openDialog", undefined)}>
              <IconFolderPlus className="size-[15px]" stroke={1.7} />
            </button>
          </Tooltip>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-0.5 px-2 pt-1">
          <SidebarRow
            icon={<IconLayoutList className="size-3.5" stroke={1.8} />}
            label="Panoramica dei progetti"
            active={mainView === "overview"}
            onClick={() => setMainView(mainView === "overview" ? "dialog" : "overview")}
          />
        </div>
        {project ? (
          <div className="flex flex-col gap-0.5 px-2 pt-0.5 pb-1.5">
            <SidebarRow
              icon={<IconTarget className="size-3.5" stroke={1.8} />}
              label="Obiettivi"
              active={isActive("goals") || isActive("goal")}
              badge={proposedGoals}
              onClick={() => setInspector({ kind: "goals" })}
            />
            <SidebarRow
              icon={<IconSitemap className="size-3.5" stroke={1.8} />}
              label="Mappa del progetto"
              active={isActive("map") || isActive("module") || isActive("file")}
              onClick={() => setInspector({ kind: "map" })}
            />
            <SidebarRow
              icon={<IconRosetteDiscountCheck className="size-3.5" stroke={1.8} />}
              label="Patto"
              active={isActive("pact") || isActive("decision")}
              badge={pendingDecisions.length}
              onClick={() => setInspector({ kind: "pact" })}
            />
            <SidebarRow
              icon={<IconShieldCheck className="size-3.5" stroke={1.8} />}
              label="Mandato"
              active={isActive("mandate")}
              badge={pendingMandate ? 1 : 0}
              onClick={() => setInspector({ kind: "mandate" })}
            />
            <SidebarRow
              icon={<IconUsersGroup className="size-3.5" stroke={1.8} />}
              label="Team"
              active={isActive("team") || isActive("specialist")}
              badge={pendingTeam ? 1 : activeWork}
              onClick={() => setInspector({ kind: "team" })}
            />
            <SidebarRow
              icon={<IconFileDiff className="size-3.5" stroke={1.8} />}
              label="Lavoro"
              active={isActive("work") || isActive("candidate")}
              badge={verifiedCandidates}
              onClick={() => setInspector({ kind: "work" })}
            />
            <SidebarRow
              icon={<IconGitPullRequest className="size-3.5" stroke={1.8} />}
              label="Gruppo"
              active={isActive("group")}
              onClick={() => setInspector({ kind: "group" })}
            />
            <SidebarRow
              icon={<IconCircleDot className="size-3.5" stroke={1.8} />}
              label="Issue"
              active={isActive("issues") || isActive("issue")}
              badge={openIssues}
              onClick={() => setInspector({ kind: "issues" })}
            />
            <SidebarRow
              icon={<IconBrain className="size-3.5" stroke={1.8} />}
              label="Memoria"
              active={isActive("memory")}
              onClick={() => setInspector({ kind: "memory" })}
            />
          </div>
        ) : null}

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
                      className={cn(SIDEBAR_ROW, "pr-8 hover:bg-[var(--sidebar-accent)]", open ? "text-foreground" : "text-foreground/89")}
                    >
                      <LeadingIcon>
                        {open ? <IconFolderOpen className="size-4" stroke={1.6} /> : <IconFolder className="size-4" stroke={1.6} />}
                      </LeadingIcon>
                      <span className="min-w-0 flex-1 truncate font-system-ui text-ui font-normal text-foreground/95">{recent.name}</span>
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
                    <div className="flex flex-col gap-0.5 pt-0.5">
                      <button
                        type="button"
                        onClick={() => openDialog(null)}
                        className={cn(SIDEBAR_ROW, "relative pl-8", mainView === "dialog" && !dialogGoalId ? ROW_ACTIVE : ROW_IDLE)}
                      >
                        <IconMessageCircle className="size-3 shrink-0 text-muted-foreground" stroke={1.8} />
                        <span className="min-w-0 flex-1 truncate text-ui leading-5">Dialogo del progetto</span>
                        <span className="flex w-[15px] shrink-0 items-center justify-center">
                          {running && !runningGoalId ? <Spinner /> : null}
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
                              // Archive always; delete only while the dialog has no history.
                              <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover/goal-row:opacity-100 focus-within:opacity-100">
                                {empty ? (
                                  <Tooltip label="Elimina il dialogo vuoto">
                                    <button
                                      type="button"
                                      aria-label={`Elimina il dialogo vuoto ${goal.title}`}
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
                          onClick={() => setInspector({ kind: "specialist", id: specialist.id })}
                          className={cn(SIDEBAR_ROW, "pl-8", inspector?.kind === "specialist" && inspector.id === specialist.id ? ROW_ACTIVE : ROW_IDLE)}
                        >
                          <AgentAvatar agent={specialist} className="-ml-0.5" />
                          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-ui leading-5 text-foreground/95">
                            <span className="min-w-0 truncate">{specialist.name}</span>
                            <AgentTag agent={specialist} className="shrink-0" />
                          </span>
                          <span className="flex w-[15px] shrink-0 items-center justify-center">
                            <StatusDot status={specialist.status} />
                          </span>
                        </button>
                      ))}
                      {pendingRows.map((row) => (
                        <button
                          key={row.id}
                          type="button"
                          onClick={() => setInspector({ kind: "pact" })}
                          title={row.title}
                          className={cn(SIDEBAR_ROW, "pl-8", ROW_IDLE)}
                        >
                          {row.round ? <IconListCheck className="size-3 shrink-0 text-muted-foreground" stroke={1.8} /> : <span className="size-3 shrink-0" />}
                          <span className="min-w-0 flex-1 truncate text-ui leading-5 text-foreground/95">{row.title}</span>
                          <span className="flex w-[15px] shrink-0 items-center justify-center">
                            <span className="size-[7px] rounded-full bg-[var(--color-text-accent)]" />
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

      <div className="flex flex-col gap-0.5 border-t border-sidebar-border p-2 font-system-ui">
        <SidebarRow icon={<IconSettings className="size-[15px]" stroke={1.7} />} label="Impostazioni"
          active={mainView === "settings"}
          onClick={() => (mainView === "settings" ? closeSettings() : openSettings("general"))}
        />
      </div>
      <DeleteGoalDialog goal={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

/**
 * The team members listed under the open project: the developers, then a fixed role only while it has work to show,
 * so eleven idle figures do not push the dialogs down. The Team panel shows everyone (W09).
 */
export function sidebarSpecialists(specialists: Specialist[]): Specialist[] {
  const members = specialists.filter((s) => s.status !== "removed");
  return [...members.filter((s) => s.role === "developer"), ...members.filter((s) => s.role !== "developer" && s.status !== "available")];
}

/** Pending decisions as sidebar rows: each grilling round becomes one row, other decisions keep their own. */
export function sidebarDecisionRows(pending: { id: string; question: string; grilling?: { subjectRequestId: string; round: number } | null }[]) {
  const rows: { id: string; title: string; round: number | null }[] = [];
  const rounds = new Map<string, { id: string; round: number; count: number }>();
  for (const request of pending) {
    if (!request.grilling) {
      rows.push({ id: request.id, title: request.question, round: null });
      continue;
    }
    const key = `${request.grilling.subjectRequestId}:${request.grilling.round}`;
    const existing = rounds.get(key);
    if (existing) existing.count += 1;
    else {
      const entry = { id: `round-${key}`, round: request.grilling.round, count: 1 };
      rounds.set(key, entry);
      rows.push({ id: entry.id, title: "", round: entry.round });
    }
  }
  return rows.map((row) => {
    if (row.round === null) return row;
    const entry = [...rounds.values()].find((r) => r.id === row.id)!;
    return { ...row, title: `Chiarimento, turno ${entry.round} · ${entry.count} ${entry.count === 1 ? "domanda" : "domande"}` };
  });
}
