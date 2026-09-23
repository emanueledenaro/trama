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
  IconLayoutSidebar,
  IconMessageCircle,
  IconPencilPlus,
  IconPlugConnected,
  IconRosetteDiscountCheck,
  IconSettings,
  IconShieldCheck,
  IconSitemap,
  IconUser,
  IconUsersGroup,
  IconX,
} from "@tabler/icons-react";
import { StatusDot } from "@/components/inspector/TeamView";
import type * as React from "react";
import { Spinner } from "@/components/Spinner";
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
  const focusComposer = useUi((s) => s.focusComposer);
  const project = app.project;
  const document = project?.document;
  const pendingDecisions = document?.decisionRequests.filter((r) => !r.outcome) ?? [];
  const pendingMandate = document?.mandateRequests.find((r) => !r.resolution) ?? null;
  const openIssues = project?.github.issues.filter((i) => i.state === "open").length ?? 0;
  const pendingTeam = document?.team.proposals.some((p) => !p.resolution) ?? false;
  const activeWork = document?.team.specialists.filter((s) => s.status === "working" || s.status === "stopping").length ?? 0;
  const verifiedCandidates = project ? Object.values(project.candidateReports).filter((r) => r.state !== "building").length : 0;
  const specialists = document?.team.specialists.filter((s) => s.status !== "removed") ?? [];
  const running = Boolean(project?.runningRequestId) || project?.phase.kind === "studying" || project?.phase.kind === "opening";
  const account = app.codex.account;
  const isActive = (kind: InspectorTarget["kind"]) => inspector?.kind === kind;

  return (
    <div className="flex h-full min-h-0 flex-col text-foreground">
      <div className={cn("drag-region flex h-[46px] shrink-0 flex-row items-center gap-2 py-0 ps-4 pe-3 font-system-ui", isMac && "desktop-top-bar-traffic-light-gutter")}>
        <div className="flex shrink-0 items-center gap-0.5">
          <SidebarTrigger />
          <NavigationButtons />
        </div>
      </div>

      <div className="flex items-center gap-1 pt-0 pr-2.5 pb-1 pl-1.5">
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
        {project ? (
          <div className="flex flex-col gap-0.5 px-1.5 pt-1 pb-1.5">
            <SidebarRow icon={<IconPencilPlus className="size-3.5" stroke={1.8} />} label="Scrivi al Coordinatore" onClick={() => focusComposer()} />
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
          </div>
        ) : null}

        <div className="px-1.5 pb-2">
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
              return (
                <div key={recent.id}>
                  <div className="group/thread-row relative">
                    <button
                      type="button"
                      onClick={() => void act("project:open", { path: recent.path })}
                      title={recent.path}
                      className={cn(SIDEBAR_ROW, "pr-8 hover:bg-[var(--sidebar-accent)]", open ? "text-foreground" : "text-foreground/89")}
                    >
                      <LeadingIcon>
                        {open ? <IconFolderOpen className="size-4" stroke={1.6} /> : <IconFolder className="size-4" stroke={1.6} />}
                      </LeadingIcon>
                      <span className="min-w-0 flex-1 truncate font-system-ui text-ui font-normal text-foreground/95">{recent.name}</span>
                    </button>
                    <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center">
                      {loading ? (
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
                      <button type="button" onClick={() => setInspector(null)} className={cn(SIDEBAR_ROW, "relative pl-8", !inspector ? ROW_ACTIVE : ROW_IDLE)}>
                        <IconMessageCircle className="size-3 shrink-0 text-muted-foreground" stroke={1.8} />
                        <span className="min-w-0 flex-1 truncate text-ui leading-5">Dialogo del progetto</span>
                        <span className="flex w-[15px] shrink-0 items-center justify-center">
                          {running ? <Spinner /> : null}
                        </span>
                      </button>
                      {specialists.map((specialist) => (
                        <button
                          key={specialist.id}
                          type="button"
                          onClick={() => setInspector({ kind: "specialist", id: specialist.id })}
                          className={cn(SIDEBAR_ROW, "pl-8", inspector?.kind === "specialist" && inspector.id === specialist.id ? ROW_ACTIVE : ROW_IDLE)}
                        >
                          <IconUser className="size-3 shrink-0 text-muted-foreground" stroke={1.8} />
                          <span className="min-w-0 flex-1 truncate text-ui leading-5 text-foreground/95">{specialist.name}</span>
                          <span className="flex w-[15px] shrink-0 items-center justify-center">
                            <StatusDot status={specialist.status} />
                          </span>
                        </button>
                      ))}
                      {pendingDecisions.map((request) => (
                        <button
                          key={request.id}
                          type="button"
                          onClick={() => setInspector({ kind: "pact" })}
                          className={cn(SIDEBAR_ROW, "pl-8", ROW_IDLE)}
                        >
                          <span className="size-3 shrink-0" />
                          <span className="min-w-0 flex-1 truncate text-ui leading-5 text-foreground/95">{request.question}</span>
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
        <SidebarRow
          icon={<IconPlugConnected className="size-[15px]" stroke={1.7} />}
          label={account?.kind === "chatgpt" ? "Codex di OpenAI" : "Collega ChatGPT"}
          onClick={() => setDialog("connections")}
          trailing={
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                account?.kind === "chatgpt" ? "bg-success" : account ? "bg-warning" : "bg-muted-foreground/40",
              )}
            />
          }
        />
        <SidebarRow icon={<IconSettings className="size-[15px]" stroke={1.7} />} label="Impostazioni" onClick={() => setDialog("settings")} />
      </div>
    </div>
  );
}
