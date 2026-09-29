import { assignmentLine, specialistLine } from "@shared/duties";
import {
  IconArrowLeft,
  IconCheck,
  IconChecklist,
  IconChevronDown,
  IconChevronRight,
  IconDots,
  IconFileDiff,
  IconFocus2,
  IconHourglass,
  IconMessageCircle,
  IconUsers,
} from "@tabler/icons-react";
import { useId, useState } from "react";
import { isUsableAccount, type ProviderId } from "@shared/codex";
import type { Specialist, SpecialistAssignment, Squad } from "@shared/domain";
import { findGoal } from "@shared/goals";
import { LANGUAGES, type MessageKey, type Translate, translator } from "@shared/i18n";
import { PROVIDERS } from "@shared/providers";
import { AGENT_PALETTE, colorName } from "@shared/identity";
import { agentThreadsByRecent, threadParticipants } from "@shared/agentThreads";
import { FIXED_ROLES, isFixedRole, roleDuties, roleProfile, teamMoments } from "@shared/roster";
import { developersOutsideSquads, sharedRoleMembers, squadLimits, squadStatusLine, teamSquads } from "@shared/squads";
import { assignmentStatus, candidateStatus } from "@shared/states";
import { type MemberSign, memberSign, squadPart, squadSlices, teamSummary } from "@shared/teamPeople";
import { AgentAvatar, AgentTag, agentStyle } from "@/components/AgentIdentity";
import { AssignmentCard, TeamProposalCard } from "@/components/chat/Cards";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { ProviderIcon } from "@/components/ProviderIcon";
import { Input, TextArea } from "@/components/ui/field";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { PickerSelect } from "@/components/ui/picker";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";
import { specialistQuestion } from "@/lib/askCoordinator";
import { AutomaticWorkSection } from "./AutomaticWork";
import { GroupBoardSection } from "./GroupBoard";
import { MergeProposalCard, MergeSquad, RenameSquad, type SquadEdit, SplitSquad, SquadMenu } from "./SquadChanges";
import { EmptyNote, InspectorSection } from "./Inspector";
import { Sep } from "@/components/ui/sep";
import { ReferenceText } from "@/components/chat/ReferenceText";

/** The specialist's own status, as the projects view still shows it beside an agent (W16). */
export function StatusDot({ status }: { status: Specialist["status"] }) {
  if (status === "working" || status === "stopping") return <Spinner />;
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        // Free reads as an empty ring, so it never looks like "at work" (issue #241).
        status === "available" && "border border-muted-foreground/60",
        status === "stopped" && "bg-warning",
        status === "removed" && "bg-muted-foreground/40",
      )}
    />
  );
}

const SIGN_LABEL: Record<MemberSign, MessageKey> = {
  working: "teams.sign.working",
  waiting: "teams.sign.waiting",
  free: "teams.sign.free",
  stopped: "teams.sign.stopped",
};

/** The sign beside a person (issue #333): a dot at work, the hourglass of Aspetta te, an empty ring when free. */
function SignMark({ sign, className }: { sign: MemberSign; className?: string }) {
  const t = useT();
  const label = t(SIGN_LABEL[sign]);
  return (
    <span role="img" aria-label={label} title={label} data-testid="member-sign" data-sign={sign} className={cn("flex size-4 shrink-0 items-center justify-center", className)}>
      {sign === "waiting" ? (
        <IconHourglass className="size-3.5 text-warning" stroke={1.8} />
      ) : (
        <span
          className={cn(
            "size-1.5 rounded-full",
            sign === "working" && "bg-success",
            sign === "stopped" && "bg-warning",
            // Free reads as an empty ring, so it never looks like "at work" (issue #241).
            sign === "free" && "border border-muted-foreground/60",
          )}
        />
      )}
    </span>
  );
}

/** A section that opens on request, with its count beside the title (issue #333). */
function Fold({
  title,
  children,
  open,
  onToggle,
  testId,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  testId?: string;
}) {
  const id = useId();
  return (
    <section className="border-b border-[color:var(--app-surface-divider)] last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        data-testid={testId ? `${testId}-toggle` : undefined}
        className="flex w-full items-center gap-1.5 px-4 py-2.5 text-left text-ui-sm text-muted-foreground transition-colors hover:text-foreground"
        onClick={onToggle}
      >
        {open ? <IconChevronDown className="size-3.5 shrink-0" stroke={1.8} /> : <IconChevronRight className="size-3.5 shrink-0" stroke={1.8} />}
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </button>
      {open ? (
        <div id={id} className="px-4 pb-3" data-testid={testId}>
          {children}
        </div>
      ) : null}
    </section>
  );
}

/** A fold that keeps its own state, closed each time its view opens. */
function useFold(): [boolean, () => void] {
  const [open, setOpen] = useState(false);
  return [open, () => setOpen((was) => !was)];
}

/** The AI Hero skills a figure relies on, or the note that the role is Trama's own addition. */
function SkillList({ skills }: { skills: string[] }) {
  const t = useT();
  if (!skills.length) return <span className="block text-ui-xs text-muted-foreground/80">{t("teams.skills.none")}</span>;
  return (
    <span className="block truncate text-ui-xs text-muted-foreground/80">
      {t("teams.skills.label")} <span className="font-mono text-[11px]">{skills.join(", ")}</span>
    </span>
  );
}

const providerLabel = (id: ProviderId) => PROVIDERS.find((p) => p.id === id)?.name ?? id;

/** The model of the latest work, on hover over a person's row: the provider, the model and whether it was motivated (UX05). */
function workHover(t: Translate, specialist: Specialist, goalTitle: string | null): string {
  const current = specialist.assignments.at(-1);
  if (!current) return specialist.id;
  const model = t(current.modelReason ? "teams.row.modelMotivated" : "teams.row.modelUnmotivated", {
    provider: providerLabel(current.provider ?? "codex"),
    model: current.model,
  });
  return [specialist.id, model, goalTitle ? t("teams.row.forGoal", { goal: goalTitle }) : null, current.modelReason].filter(Boolean).join("\n");
}

const ROW = "flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-[var(--sidebar-accent)]";

/**
 * A person of the team in one row (issue #333): the bot, the name with the role's tag, what it does now in one line
 * and the sign. The id and the model stay on hover.
 */
function PersonRow({ specialist }: { specialist: Specialist }) {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const selected = useUi((s) => s.inspector?.kind === "specialist" && s.inspector.id === specialist.id);
  const document = project.document;
  const sign = memberSign(document, project.candidateReports, specialist);
  const goal = findGoal(document, specialist.assignments.at(-1)?.goalId ?? null);
  // A free role that never worked says what it does; anyone else says what the latest work left.
  const now =
    sign !== "free" || specialist.assignments.length
      ? sign === "free"
        ? t("teams.sign.free")
        : specialistLine(t, document, specialist)
      : specialist.role === "developer"
        ? t("teams.sign.free")
        : (roleDuties(t, specialist.role)[0]?.task ?? t("teams.sign.free"));
  return (
    <button
      type="button"
      data-testid={specialist.role === "developer" ? "team-developer" : "team-figure"}
      data-role={specialist.role}
      data-sign={sign}
      aria-current={selected || undefined}
      title={workHover(t, specialist, goal?.title ?? null)}
      onClick={() => setInspector({ kind: "specialist", id: specialist.id })}
      className={cn(ROW, selected && "bg-[var(--sidebar-selected)]")}
    >
      <span className="flex w-8 shrink-0 justify-center">
        <AgentAvatar agent={specialist} size={32} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5 text-ui text-foreground">
          <span className="min-w-0 truncate">{specialist.name}</span>
          <AgentTag agent={specialist} className="shrink-0 text-ui-xs" />
        </span>
        <span className="block truncate text-ui-sm text-muted-foreground" data-testid="member-now">
          <ReferenceText text={now} links={false} />
        </span>
      </span>
      <SignMark sign={sign} />
    </button>
  );
}

const byIds = (specialists: Specialist[], ids: string[]) => ids.flatMap((id) => specialists.filter((s) => s.id === id && s.status !== "removed"));

/** One squad (A10): its area and the slices done on the first line, its status line, then the lead, the developers and the QA. */
function SquadGroup({ squad }: { squad: Squad }) {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const document = project.document;
  const specialists = document.team.specialists;
  const modules = squad.moduleIds.map((id) => project.snapshot.modules.find((m) => m.id === id)?.name ?? id);
  const area = modules.length ? modules.join(", ") : t("teams.squad.wholeProject");
  const slices = squadSlices(document, project.sliceViews, squad);
  const [edit, setEdit] = useState<SquadEdit | null>(null);
  const done = () => setEdit(null);
  // The id stays on hover; a squad the person changed says the Coordinator leaves it as it is (A11).
  const hover = squad.touchedAt ? `${squad.id}\n${t("teams.squad.changed")}` : squad.id;
  return (
    <section className="border-b border-[color:var(--app-surface-divider)] px-2 py-2.5" data-testid="squad" data-squad={squad.name} data-squad-id={squad.id}>
      <div className="flex min-w-0 items-center gap-1">
        <p className="min-w-0 flex-1 truncate px-2 text-ui-sm text-muted-foreground" title={hover} data-testid="squad-header">
          <span className="font-medium text-foreground">{squad.name}</span>
          <Sep />
          {area}
          <Sep />
          {slices.total ? t("teams.squad.slices", { done: slices.done, count: slices.total }) : t("teams.squad.noSlices")}
        </p>
        <SquadMenu squad={squad} onEdit={setEdit} />
      </div>
      {edit === "rename" ? <RenameSquad squad={squad} onDone={done} /> : null}
      {edit === "merge" ? <MergeSquad squad={squad} onDone={done} /> : null}
      {edit === "split" ? <SplitSquad squad={squad} onDone={done} /> : null}
      <p className="mt-0.5 px-2 text-ui-xs text-muted-foreground" data-testid="squad-status">
        <ReferenceText text={squadStatusLine(t, document, squad)} links={false} />
      </p>
      <div className="mt-1 flex flex-col">
        {byIds(specialists, [squad.leadId, ...squad.developerIds, squad.qaId]).map((s) => (
          <PersonRow key={s.id} specialist={s} />
        ))}
      </div>
    </section>
  );
}

/**
 * On top of the view (issue #333): how many squads and people work now, whether two of them touch the same files, and
 * a colleague on the repository from Gruppo's presence.
 */
function SquadsSummary() {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const summary = teamSummary(project.document, project.candidateReports, project.presence);
  const colleague = (project.presence?.others ?? []).find((entry) => !entry.self && entry.status !== "expired") ?? null;
  const shared = colleague ? (project.overlaps?.items ?? []).filter((item) => item.colleague.user === colleague.record.user).flatMap((item) => item.files) : [];
  const colleagueText = colleague
    ? t(colleague.record.activeBranch ? "teams.summary.colleagueOn" : "teams.summary.colleague", {
        name: colleague.record.name,
        branch: colleague.record.activeBranch ?? "",
        files: shared.length ? t("teams.summary.filesInCommon", { count: new Set(shared).size }) : t("teams.summary.noFilesInCommon"),
      })
    : null;
  const lead = summary.squads
    ? summary.squadsAtWork
      ? t("teams.summary.squadsAtWork", { count: summary.squadsAtWork })
      : t("teams.summary.noSquadAtWork")
    : t("teams.summary.noSquads");
  return (
    <section className="border-b border-[color:var(--app-surface-divider)] px-4 py-3" data-testid="squads-summary">
      <p className="text-ui-lg text-foreground">{lead}</p>
      <p className="mt-1 text-ui-sm text-muted-foreground">
        {summary.peopleAtWork ? t("teams.summary.peopleAtWork", { count: summary.peopleAtWork }) : t("teams.summary.nobodyAtWork")}
        {summary.peopleAtWork > 1 && !summary.sameFiles.length ? ` ${t("teams.summary.noSameFiles")}` : null}
      </p>
      {summary.sameFiles.map((pair) => (
        <p key={pair.names.join()} className="mt-1 text-ui-sm text-warning" data-testid="squads-same-files" title={pair.files.join("\n")}>
          {t("teams.summary.sameFiles", { names: pair.names.join(", "), count: pair.files.length })}
        </p>
      ))}
      {colleagueText ? (
        <button
          type="button"
          className="mt-1.5 flex w-full min-w-0 items-center gap-1.5 text-left text-ui-sm text-muted-foreground hover:text-foreground"
          title={colleagueText}
          data-testid="squads-colleague"
          onClick={() => setInspector({ kind: "group" })}
        >
          <IconUsers className="size-3.5 shrink-0" stroke={1.8} />
          <span className="min-w-0 truncate">{colleagueText}</span>
        </button>
      ) : null}
    </section>
  );
}

/** Squads (A10, Q23, issue #333): who works now on top, then each squad with its people, the shared roles and the automatic work. */
export function SquadsView() {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const document = project.document;
  const team = document.team;
  const pending = team.proposals.find((p) => !p.resolution);
  const former = team.specialists.filter((s) => s.status === "removed");
  const squads = teamSquads(document);
  const outside = developersOutsideSquads(document);
  const shared = sharedRoleMembers(document);
  const sharedAtWork = shared.filter((s) => memberSign(document, project.candidateReports, s) === "working").length;
  const limits = squadLimits(document);
  const [sharedOpen, toggleShared] = useFold();
  const [formerOpen, toggleFormer] = useFold();
  const [aboutOpen, toggleAbout] = useFold();
  return (
    <>
      <SquadsSummary />
      {team.squadMerge ? <MergeProposalCard key={team.squadMerge.id} proposal={team.squadMerge} /> : null}
      {/* Who works on what, from the old Gruppo view (issue #332): the people and agents on the repository, with their presence. */}
      <GroupBoardSection />
      {pending ? (
        <InspectorSection title={t("teams.pendingProposal")}>
          <TeamProposalCard proposalId={pending.id} />
        </InspectorSection>
      ) : null}
      {squads.map((squad) => (
        <SquadGroup key={squad.id} squad={squad} />
      ))}
      {!squads.length || outside.length ? (
        <section className="border-b border-[color:var(--app-surface-divider)] px-2 py-2.5">
          <p className="px-2 text-ui-sm font-medium text-foreground">{squads.length ? t("teams.outside.title") : t("teams.developers.title")}</p>
          <p className="mt-0.5 px-2 text-ui-xs text-muted-foreground">
            {squads.length ? t("teams.outside.note") : team.confirmedAt !== null ? t("teams.developers.unformed") : t("teams.developers.unproposed")}
          </p>
          <div className="mt-1 flex flex-col">
            {outside.map((specialist) => (
              <PersonRow key={specialist.id} specialist={specialist} />
            ))}
          </div>
        </section>
      ) : null}
      <Fold
        open={sharedOpen}
        onToggle={toggleShared}
        testId="shared-roles"
        title={
          <>
            {t("teams.shared.title")}
            <Sep />
            {sharedAtWork ? t("teams.shared.countAtWork", { count: shared.length, working: sharedAtWork }) : shared.length}
          </>
        }
      >
        <p className="text-ui-xs text-muted-foreground">{t("teams.shared.note")}</p>
        <div className="-mx-2 mt-1 flex flex-col">
          {shared.map((specialist) => (
            <PersonRow key={specialist.id} specialist={specialist} />
          ))}
        </div>
      </Fold>
      <AutomaticWorkSection />
      {former.length ? (
        <Fold
          open={formerOpen}
          onToggle={toggleFormer}
          title={
            <>
              {t("teams.former.title")}
              <Sep />
              {former.length}
            </>
          }
        >
          {former.map((s) => (
            <p key={s.id} className="text-ui-sm text-muted-foreground" title={s.id}>
              {s.name}
              <Sep />
              {s.removal ? <ReferenceText text={s.removal.reason} links={false} /> : null}
            </p>
          ))}
        </Fold>
      ) : null}
      <Fold open={aboutOpen} onToggle={toggleAbout} title={t("teams.about.title")}>
        <p className="text-ui-sm text-muted-foreground">
          {t("teams.about.squads", {
            developers: limits.developersPerSquad,
            squads: limits.activeSquads === 1 ? t("teams.about.oneSquad") : t("teams.about.squadsCount", { count: limits.activeSquads }),
          })}
        </p>
        <p className="mt-2 text-ui-sm text-muted-foreground">
          {t("teams.about.automatic")}
          {project.isDemo ? ` ${t("teams.about.demo")}` : document.mandate?.status === "granted" ? "" : ` ${t("teams.about.needsMandate")}`}
        </p>
      </Fold>
    </>
  );
}

/** Where the agent sits among the squads (A10): its squad and its part in it, or the shared roles. */
function squadLine(t: Translate, document: Parameters<typeof squadPart>[0], specialist: Specialist): string {
  const { part, squad } = squadPart(document, specialist);
  switch (part) {
    case "lead":
      return t("teams.part.lead", { squad: squad!.name });
    case "qa":
      return t("teams.part.qa", { squad: squad!.name });
    case "developer":
      return t("teams.part.developer", { squad: squad!.name });
    case "outside":
      return t("teams.part.outside");
    case "unformed":
      return t("teams.part.unformed");
    case "shared":
      return t("teams.part.shared");
  }
}

/** The assignment still open, as the Ora section shows it: running, waiting for an answer, or stopped with its way back. */
const OPEN_WORK: SpecialistAssignment["status"][] = ["preparing", "running", "stopRequested", "paused", "stopped", "failed"];

/**
 * A person of the squad (issue #333, the specialist of W13): the header with the bot, the name, the role and the sign,
 * Ask and the menu with Rename and Remove; then the work now, the last result, the assignments and the conversations
 * between agents as compact rows; and closed at the bottom why it is in the squad, when it steps in, its working copy
 * and its color. Until B07 it opens in the side bar with the way back.
 */
export function SpecialistView({ id }: { id: string }) {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const askCoordinator = useUi((s) => s.askCoordinator);
  const [removing, setRemoving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [reason, setReason] = useState("");
  const [whyOpen, toggleWhy] = useFold();
  const [dutiesOpen, toggleDuties] = useFold();
  const [workspaceOpen, toggleWorkspace] = useFold();
  const [colorOpen, toggleColor] = useFold();
  const document = project.document;
  const specialist = document.team.specialists.find((s) => s.id === id);
  if (!specialist) return <div className="p-4"><EmptyNote>{t("teams.person.missing")}</EmptyNote></div>;
  const current = specialist.assignments.at(-1);
  const busy = current && ["preparing", "running", "stopRequested"].includes(current.status);
  const fixed = isFixedRole(specialist.role);
  const sign = memberSign(document, project.candidateReports, specialist);
  const squad = squadPart(document, specialist).squad;
  const now = current && OPEN_WORK.includes(current.status) ? current : null;
  const lastResult = [...specialist.assignments].reverse().find((a) => a.status === "completed" && a.id !== now?.id) ?? null;
  const others = [...specialist.assignments].reverse().filter((a) => a.id !== now?.id && a.id !== lastResult?.id);
  const workspace = current?.workspace && !current.workspaceRemovedAt && ["stopped", "failed", "completed"].includes(current.status) ? current.workspace : null;
  const menu = specialist.status !== "removed" && !fixed;
  // The question goes to the dialog of the goal the latest assignment serves; otherwise to the dialog on screen.
  const ask = () => {
    const goalId = findGoal(document, current?.goalId ?? null)?.id;
    askCoordinator(specialistQuestion(specialist, current ?? null), goalId ? { goalId } : {});
  };
  return (
    <div data-testid="specialist" data-specialist-id={specialist.id}>
      <div className="border-b border-[color:var(--app-surface-divider)] px-4 pt-3 pb-3">
        <div className="flex min-w-0 items-center gap-1 text-ui-sm text-muted-foreground">
          <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setInspector({ kind: "team" })}>
            <IconArrowLeft className="size-3.5" /> {t("workbench.view.teams")}
          </button>
          {squad ? (
            <>
              <span aria-hidden className="text-muted-foreground/60">
                ›
              </span>
              <span className="min-w-0 truncate">{squad.name}</span>
            </>
          ) : null}
        </div>
        {/* The bot sits beside the header, so it takes no room from the name and the status; the status never shrinks.
            The id stays on hover. */}
        <div className="mt-2 flex items-start gap-3" data-testid="specialist-header" title={specialist.id}>
          <AgentAvatar agent={specialist} size={48} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              {/* The id is Trama's, not the person's: it stays on hover (issue #392). */}
              <h3
                className="min-w-0 max-w-full truncate text-ui-lg font-medium text-foreground"
                title={`${specialist.name}, ${specialist.id}`}
                data-record-id={specialist.id}
              >
                {specialist.name}
              </h3>
              <AgentTag agent={specialist} className="shrink-0 text-ui-sm" />
            </div>
            <p className="mt-0.5 truncate text-ui-sm text-muted-foreground" data-testid="specialist-squad">
              {squadLine(t, document, specialist)}
            </p>
            <span className="mt-1 flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap text-ui-sm text-foreground/90" data-testid="specialist-status">
              <SignMark sign={sign} className="size-3" /> {t(SIGN_LABEL[sign])}
            </span>
          </div>
        </div>
        <div className="cta-row mt-2">
          {menu ? (
            <Menu>
              <Tooltip label={t("teams.person.more")}>
                <MenuTrigger aria-label={t("teams.person.more")} className="sidebar-icon-button inline-flex size-7 items-center justify-center rounded-md" data-testid="specialist-menu">
                  <IconDots className="size-4" stroke={1.8} />
                </MenuTrigger>
              </Tooltip>
              <MenuPopup align="end">
                <MenuItem
                  onClick={() => {
                    setRenaming(true);
                    setRemoving(false);
                  }}
                >
                  {t("teams.person.rename")}
                </MenuItem>
                {!busy ? (
                  <MenuItem
                    destructive
                    onClick={() => {
                      setRemoving(true);
                      setRenaming(false);
                    }}
                  >
                    {t("teams.person.remove")}
                  </MenuItem>
                ) : null}
              </MenuPopup>
            </Menu>
          ) : null}
          <Button size="sm" variant="outline" aria-label={t("teams.person.askLong")} onClick={ask}>
            <IconMessageCircle stroke={1.8} /> {t("teams.person.ask")}
          </Button>
        </div>
        {renaming ? <RenameSpecialist specialist={specialist} onDone={() => setRenaming(false)} /> : null}
        {removing ? (
          <div className="mt-2 space-y-2" data-testid="remove-specialist">
            <TextArea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("teams.person.removeReason")}
              aria-label={t("teams.person.removeReason")}
              className="min-h-12"
            />
            <div className="cta-row">
              <Button size="sm" variant="ghost" onClick={() => setRemoving(false)}>
                {t("teams.person.cancel")}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={!reason.trim()}
                onClick={() => void act("specialist:remove", { specialistId: specialist.id, reason: reason.trim() }).then(() => setRemoving(false))}
              >
                {t("teams.person.removeNamed", { name: specialist.name })}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      <NowSection assignment={now} />
      {now && ["stopped", "failed"].includes(now.status) ? <AssignmentProvider assignment={now} /> : null}
      {lastResult ? (
        <InspectorSection title={t("teams.person.lastResult")}>
          <div className="-mx-2" data-testid="specialist-last-result">
            <AssignmentRow assignment={lastResult} done />
          </div>
        </InspectorSection>
      ) : null}
      {fixed ? <AutomaticWorkSection role={specialist.role} /> : null}
      <InspectorSection title={t("teams.person.assignments", { count: specialist.assignments.length })}>
        {specialist.assignments.length === 0 ? <EmptyNote>{t("teams.person.noAssignments")}</EmptyNote> : null}
        {specialist.assignments.length && !others.length ? <EmptyNote>{t("teams.person.noOtherAssignments")}</EmptyNote> : null}
        <div className="-mx-2 flex flex-col" data-testid="specialist-assignments">
          {others.map((assignment) => (
            <AssignmentRow key={assignment.id} assignment={assignment} />
          ))}
        </div>
      </InspectorSection>
      <SpecialistThreads specialistId={specialist.id} />
      <Fold open={whyOpen} onToggle={toggleWhy} title={t("teams.person.why")}>
        <p className="text-ui text-foreground/90">
          <ReferenceText text={specialist.reason} />
        </p>
        <p className="mt-1 text-ui-sm text-muted-foreground">{specialist.competence}</p>
        <p className="mt-1 text-ui-xs text-muted-foreground">
          {t(specialist.origin === "fixedRole" ? "teams.origin.fixedRole" : specialist.origin === "teamProposal" ? "teams.origin.teamProposal" : "teams.origin.coordinator")}
          <Sep />
          {formatRelativeTime(specialist.createdAt)}
        </p>
      </Fold>
      <Fold open={dutiesOpen} onToggle={toggleDuties} title={t("teams.person.duties")}>
        <div className="flex flex-col gap-1.5">
          {roleDuties(t, specialist.role).map((duty) => (
            <div key={duty.moment}>
              <span className="block text-ui text-foreground/90">
                {teamMoments(t).find((m) => m.moment === duty.moment)!.label}
                <Sep />
                {duty.task}
              </span>
              <SkillList skills={duty.skills} />
            </div>
          ))}
        </div>
      </Fold>
      {workspace && current ? (
        <Fold
          open={workspaceOpen}
          onToggle={toggleWorkspace}
          title={
            <>
              {t("teams.person.workspace")}
              <Sep />
              <span className="font-mono">{workspace.branch}</span>
            </>
          }
        >
          <p className="text-ui-sm text-muted-foreground">
            <span className="font-mono">{workspace.branch}</span>. {t("teams.person.workspaceNote")}
          </p>
          <div className="cta-row mt-2">
            <Button size="sm" variant="ghost" onClick={() => void act("assignment:removeWorktree", { assignmentId: current.id })}>
              {t("teams.person.removeWorkspace")}
            </Button>
          </div>
        </Fold>
      ) : null}
      {specialist.status !== "removed" ? (
        <Fold open={colorOpen} onToggle={toggleColor} title={t("teams.person.color")}>
          <AgentColorPicker specialist={specialist} />
        </Fold>
      ) : null}
    </div>
  );
}

/** The latest candidate of an assignment, if it declared one. */
function useAssignmentCandidate(assignmentId: string) {
  const candidates = useUi((s) => s.app?.project?.document.candidates);
  return (candidates ?? []).filter((c) => c.assignmentId === assignmentId).at(-1) ?? null;
}

/**
 * The work now (issue #333): the assignment in progress with its card, and above it, as icons, the diff of its
 * candidate and the in-depth examination.
 */
function NowSection({ assignment }: { assignment: SpecialistAssignment | null }) {
  const t = useT();
  const setInspector = useUi((s) => s.setInspector);
  const audits = useUi((s) => s.app?.project?.document.audits);
  const candidate = useAssignmentCandidate(assignment?.id ?? "");
  const examine = () => {
    if (!candidate) return;
    // Focus mode opens the latest examination of this candidate, or starts the first one (F01).
    const latest = (audits ?? []).filter((a) => a.target.candidateId === candidate.id).at(-1);
    if (latest) setInspector({ kind: "audit", id: latest.id });
    else void act("candidate:focusAudit", { candidateId: candidate.id }).then((next) => next && setInspector({ kind: "audit", id: next }));
  };
  return (
    <InspectorSection
      title={t("teams.person.now")}
      aside={
        candidate ? (
          <span className="flex items-center gap-0.5" data-testid="specialist-now-actions">
            <Tooltip label={t("teams.person.openDiff")}>
              <button
                type="button"
                aria-label={t("teams.person.openDiff")}
                className="sidebar-icon-button size-6 rounded-md"
                onClick={() => setInspector({ kind: "candidate", id: candidate.id })}
              >
                <IconFileDiff className="size-3.5" stroke={1.8} />
              </button>
            </Tooltip>
            <Tooltip label={t("teams.person.examine")}>
              <button type="button" aria-label={t("teams.person.examine")} className="sidebar-icon-button size-6 rounded-md" onClick={examine}>
                <IconFocus2 className="size-3.5" stroke={1.8} />
              </button>
            </Tooltip>
          </span>
        ) : null
      }
    >
      <div data-testid="specialist-now">{assignment ? <AssignmentCard assignmentId={assignment.id} /> : <EmptyNote>{t("teams.person.nothingNow")}</EmptyNote>}</div>
    </InspectorSection>
  );
}

/**
 * An assignment in one row: its objective, its state and, when it has one, its candidate's. A click opens its whole
 * card in place, with the result and the actions of today; the candidate opens with the diff from its arrow.
 */
function AssignmentRow({ assignment, done = false }: { assignment: SpecialistAssignment; done?: boolean }) {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const candidate = useAssignmentCandidate(assignment.id);
  const [open, setOpen] = useState(false);
  const report = candidate ? project.candidateReports[candidate.id] : undefined;
  const state = report ? candidateStatus(t, report) : assignmentStatus(t, assignment.status);
  const goal = assignment.goalId ? (findGoal(project.document, assignment.goalId)?.title ?? null) : null;
  const hover = [
    assignment.id,
    t("teams.row.model", { provider: providerLabel(assignment.provider ?? "codex"), model: assignment.model }),
    goal ? t("teams.row.forGoal", { goal }) : null,
    assignment.modelReason,
  ]
    .filter(Boolean)
    .join("\n");
  const Icon = done ? IconCheck : candidate ? IconFileDiff : IconChecklist;
  return (
    <div data-testid="assignment-row" data-assignment-id={assignment.id}>
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-ui transition-colors hover:bg-[var(--sidebar-accent)]"
          title={hover}
          onClick={() => setOpen(!open)}
        >
          <Icon className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-foreground/90">
              <ReferenceText text={assignment.objective} links={false} />
            </span>
            {done ? (
              <span className="block truncate text-ui-xs text-muted-foreground" data-testid="assignment-row-outcome">
                <ReferenceText text={assignmentLine(t, project.document, assignment)} links={false} />
                <Sep />
                {formatRelativeTime(assignment.updatedAt)}
              </span>
            ) : null}
          </span>
          <span className="shrink-0 text-ui-xs text-muted-foreground">{state.label}</span>
        </button>
        {candidate ? (
          <Tooltip label={t("teams.person.openCandidate")}>
            <button
              type="button"
              aria-label={t("teams.person.openCandidate")}
              className="sidebar-icon-button size-6 shrink-0 rounded-md"
              onClick={() => setInspector({ kind: "candidate", id: candidate.id })}
            >
              <IconChevronRight className="size-3.5" stroke={1.8} />
            </button>
          </Tooltip>
        ) : null}
      </div>
      {open ? (
        <div className="px-2 pb-2">
          <AssignmentCard assignmentId={assignment.id} />
        </div>
      ) : null}
    </div>
  );
}

const nameKey = (name: string) => name.trim().toLocaleLowerCase("it").replace(/\s+/g, " ");

/** The person renames a developer (W13): the id stays, so assignments, chat and history follow the new name. */
function RenameSpecialist({ specialist, onDone }: { specialist: Specialist; onDone: () => void }) {
  const t = useT();
  const specialists = useUi((s) => s.app?.project?.document.team.specialists ?? []);
  const [name, setName] = useState(specialist.name);
  const next = name.trim();
  const taken = specialists.some((s) => s.id !== specialist.id && s.status !== "removed" && nameKey(s.name) === nameKey(next));
  const fixedName = FIXED_ROLES.some((role) => LANGUAGES.some((language) => nameKey(roleProfile(translator(language), role).name) === nameKey(next)));
  const unchanged = next === specialist.name;
  const save = () => void act("specialist:rename", { specialistId: specialist.id, name: next }).then(onDone);
  return (
    <div className="mt-2 space-y-2" data-testid="rename-specialist">
      <Input
        autoFocus
        aria-label={t("teams.rename.label")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && next && !taken && !fixedName && !unchanged) save();
          if (e.key === "Escape") onDone();
        }}
      />
      {taken ? <p className="text-ui-sm text-muted-foreground">{t("teams.rename.taken")}</p> : null}
      {fixedName ? <p className="text-ui-sm text-muted-foreground">{t("teams.rename.fixedName")}</p> : null}
      <p className="text-ui-xs text-muted-foreground" title={specialist.id}>
        {t("team.rename.followsName")}
      </p>
      <div className="cta-row">
        <Button size="sm" variant="ghost" onClick={onDone}>
          {t("teams.person.cancel")}
        </Button>
        <Button size="sm" disabled={!next || taken || fixedName || unchanged} onClick={save}>
          {t("teams.person.rename")}
        </Button>
      </div>
    </div>
  );
}

/** The agent's color (W15): Trama picked a free one; the person may choose another from the palette. */
function AgentColorPicker({ specialist }: { specialist: Specialist }) {
  const t = useT();
  return (
    <>
      <p className="text-ui-sm text-muted-foreground">{t("teams.color.note")}</p>
      <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("teams.color.label")}>
        {AGENT_PALETTE.map((entry) => {
          const selected = entry.color === specialist.color;
          return (
            <Tooltip key={entry.color} label={colorName(t, entry.color)}>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={colorName(t, entry.color)}
                data-testid="agent-color"
                className={cn(
                  "agent-identity inline-flex size-10 items-center justify-center rounded-full transition-shadow",
                  selected ? "ring-2 ring-[var(--agent)] ring-offset-1 ring-offset-background" : "hover:ring-1 hover:ring-[var(--agent)]",
                )}
                style={agentStyle({ color: entry.color })}
                onClick={() => (selected ? undefined : void act("specialist:setColor", { specialistId: specialist.id, color: entry.color }))}
              >
                <AgentAvatar agent={{ ...specialist, color: entry.color }} activity="idle" size={32} />
              </button>
            </Tooltip>
          );
        })}
      </div>
    </>
  );
}

/** The person changes the provider of a stopped assignment (ADR 0009): assignment and worktree stay. */
function AssignmentProvider({ assignment }: { assignment: SpecialistAssignment }) {
  const t = useT();
  const providers = useUi((s) => s.app!.providers);
  const current = assignment.provider ?? "codex";
  const [provider, setProvider] = useState<ProviderId>(current);
  const models = providers[provider]?.models ?? [];
  const [model, setModel] = useState(assignment.model);
  const connected = PROVIDERS.map((p) => p.id as ProviderId).filter((id) => isUsableAccount(providers[id]?.account));
  const validModel = models.length === 0 || models.some((m) => m.model === model);
  const unchanged = provider === current && model === assignment.model;
  return (
    <InspectorSection title={t("teams.provider.title")}>
      <p className="text-ui-sm text-muted-foreground">{t("teams.provider.note", { provider: providerLabel(current), model: assignment.model })}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-ui-sm">
        <PickerSelect
          label={t("teams.provider.provider")}
          value={provider}
          options={connected.map((id) => ({ value: id, title: providerLabel(id), icon: <ProviderIcon provider={id} /> }))}
          onChange={(next) => {
            setProvider(next);
            setModel(providers[next]?.models.find((m) => m.isDefault)?.model ?? providers[next]?.models[0]?.model ?? "");
          }}
        />
        <PickerSelect
          label={t("teams.provider.model")}
          value={model}
          title={providerLabel(provider)}
          meta={t("teams.provider.models", { count: models.length })}
          searchPlaceholder={t("teams.provider.search")}
          className="flex-1"
          options={[
            ...(!validModel ? [{ value: model, title: t("teams.provider.unavailable", { model }), disabled: true }] : []),
            ...models.map((m) => ({ value: m.model, title: m.displayName, subtitle: m.description?.replaceAll(" · ", ", ") })),
          ]}
          onChange={setModel}
        />
        <Button
          size="sm"
          variant="outline"
          disabled={unchanged || !model || !validModel || !connected.includes(provider)}
          onClick={() => void act("assignment:changeProvider", { assignmentId: assignment.id, provider, model })}
        >
          {t("teams.provider.change")}
        </Button>
      </div>
    </InspectorSection>
  );
}

/** Every conversation between agents the specialist takes part in (W07), the most recent first, as compact rows. */
function SpecialistThreads({ specialistId }: { specialistId: string }) {
  const t = useT();
  const document = useUi((s) => s.app?.project?.document);
  const setInspector = useUi((s) => s.setInspector);
  const threads = agentThreadsByRecent(document?.agentThreads ?? []).filter((thread) => thread.specialistIds.includes(specialistId));
  if (!document || !threads.length) return null;
  return (
    <InspectorSection title={t("teams.person.threads", { count: threads.length })}>
      <div className="-mx-2 flex flex-col" data-testid="specialist-threads">
        {threads.map((thread) => (
          <button
            key={thread.id}
            type="button"
            title={thread.id}
            className="flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-ui hover:bg-[var(--sidebar-accent)]"
            onClick={() => setInspector({ kind: "agentThread", id: thread.id })}
          >
            <IconMessageCircle className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
            <span className="min-w-0 flex-1 truncate text-foreground/90">
              <ReferenceText text={thread.title} links={false} />
            </span>
            <span className="max-w-[40%] shrink-0 truncate text-ui-xs text-muted-foreground">{threadParticipants(t, thread, document.team.specialists)}</span>
          </button>
        ))}
      </div>
    </InspectorSection>
  );
}
