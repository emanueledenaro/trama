import { IconArrowLeft, IconMessageCircle } from "@tabler/icons-react";
import { useState } from "react";
import { isUsableAccount, type ProviderId } from "@shared/codex";
import type { Specialist, SpecialistAssignment, Squad } from "@shared/domain";
import { findGoal } from "@shared/goals";
import { PROVIDERS } from "@shared/providers";
import { AGENT_PALETTE } from "@shared/identity";
import { agentThreadsByRecent, threadParticipants } from "@shared/agentThreads";
import { FIXED_ROLES, isFixedRole, roleDuties, roleProfile, TEAM_MOMENTS } from "@shared/roster";
import { developersOutsideSquads, sharedRoleMembers, squadLimits, squadOf, squadStatusLine, teamSquads } from "@shared/squads";
import { AgentAvatar, AgentName, AgentTag, agentStyle } from "@/components/AgentIdentity";
import { ASSIGNMENT_STATUS, AssignmentCard, CandidateCard, TeamProposalCard } from "@/components/chat/Cards";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { ProviderIcon } from "@/components/ProviderIcon";
import { Badge, Input, TextArea } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/tooltip";
import { PickerSelect } from "@/components/ui/picker";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { act, useUi } from "@/lib/store";
import { specialistQuestion } from "@/lib/askCoordinator";
import { AutomaticWorkSection } from "./AutomaticWork";
import { EmptyNote, InspectorSection } from "./Inspector";
import { Sep } from "@/components/ui/sep";

const STATUS_LABEL: Record<Specialist["status"], string> = {
  available: "libero",
  working: "al lavoro",
  stopping: "in arresto",
  stopped: "fermato",
  removed: "fuori dal team",
};

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

/** The AI Hero skills a figure relies on, or the note that the role is Trama's own addition. */
function SkillList({ skills }: { skills: string[] }) {
  if (!skills.length) return <span className="block text-ui-xs text-muted-foreground/80">Aggiunta di Trama, senza skill</span>;
  return (
    <span className="block truncate text-ui-xs text-muted-foreground/80">
      Skill: <span className="font-mono text-[11px]">{skills.join(", ")}</span>
    </span>
  );
}

const ROW = "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--sidebar-accent)]";

/** A developer of the project: competence, status and the provider and model of its current work (UX05). */
function DeveloperRow({ specialist }: { specialist: Specialist }) {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const current = specialist.assignments.at(-1);
  const goal = current ? findGoal(project.document, current.goalId) : null;
  return (
    <button type="button" data-testid="team-developer" onClick={() => setInspector({ kind: "specialist", id: specialist.id })} className={ROW}>
      <span className="flex w-8 justify-center">
        <AgentAvatar agent={specialist} size={32} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-ui text-foreground">
          <AgentName agent={specialist} avatar={false} /> <span className="text-muted-foreground"><Sep />{specialist.competence}</span>
        </span>
        <span className="flex items-center gap-1.5 truncate text-ui-sm text-muted-foreground">
          <StatusDot status={specialist.status} />
          <span className="min-w-0 truncate">{STATUS_LABEL[specialist.status]}<Sep />{specialist.lastUpdate}</span>
        </span>
        {current ? (
          <span className="block truncate text-ui-xs text-muted-foreground/80" title={current.modelReason ?? "Motivazione non registrata"}>
            {providerLabel(current.provider ?? "codex")}<Sep />{current.model}
            {current.modelReason ? ", motivato" : ", motivazione non registrata"}
            {goal ? `, per ${goal.title}` : ""}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/** What a member does in the flow and with which skills, from its role's moments. */
function roleSummary(specialist: Specialist): { task: string; skills: string[] } {
  const duties = roleDuties(specialist.role);
  return { task: duties.map((d) => d.task).join(" "), skills: [...new Set(duties.flatMap((d) => d.skills))] };
}

/** A squad lead, a squad's QA or a shared role: what it does and with which skills; it opens the specialist. */
function MemberRow({ specialist }: { specialist: Specialist }) {
  const setInspector = useUi((s) => s.setInspector);
  const { task, skills } = roleSummary(specialist);
  return (
    <button
      type="button"
      data-testid="team-figure"
      data-role={specialist.role}
      onClick={() => setInspector({ kind: "specialist", id: specialist.id })}
      className={ROW}
    >
      <span className="flex w-8 justify-center">
        <AgentAvatar agent={specialist} size={32} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-ui text-foreground">
          <AgentName agent={specialist} avatar={false} />
          {specialist.status !== "available" ? <StatusDot status={specialist.status} /> : null}
        </span>
        <span className="block text-ui-sm text-muted-foreground">{task}</span>
        {specialist.status !== "available" ? (
          <span className="block truncate text-ui-sm text-muted-foreground">
            {STATUS_LABEL[specialist.status]}<Sep />{specialist.lastUpdate}
          </span>
        ) : null}
        <SkillList skills={skills} />
      </span>
    </button>
  );
}

const byIds = (specialists: Specialist[], ids: string[]) =>
  ids.flatMap((id) => specialists.filter((s) => s.id === id && s.status !== "removed"));

/** One squad (A10): its area, its status line, then the squad lead, the developers and the dedicated QA. */
function SquadSection({ squad }: { squad: Squad }) {
  const project = useUi((s) => s.app?.project)!;
  const document = project.document;
  const specialists = document.team.specialists;
  const modules = squad.moduleIds.map((id) => project.snapshot.modules.find((m) => m.id === id)?.relativePath ?? id);
  const developers = byIds(specialists, squad.developerIds);
  const working = developers.some((s) => s.status === "working" || s.status === "stopping");
  return (
    <InspectorSection title={`Squadra ${squad.name}`}>
      <div data-testid="squad" data-squad={squad.name}>
        <p className="text-ui-sm text-muted-foreground">{modules.length ? `Area: ${modules.join(", ")}` : "Area: tutto il progetto"}</p>
        <p className="mt-1 flex items-center gap-1.5 text-ui-sm text-foreground/90" data-testid="squad-status">
          <StatusDot status={working ? "working" : "available"} />
          <span className="min-w-0">{squadStatusLine(document, squad)}</span>
        </p>
        <div className="-mx-2 mt-1 flex flex-col gap-0.5">
          {byIds(specialists, [squad.leadId]).map((s) => (
            <MemberRow key={s.id} specialist={s} />
          ))}
          {developers.map((s) => (
            <DeveloperRow key={s.id} specialist={s} />
          ))}
          {byIds(specialists, [squad.qaId]).map((s) => (
            <MemberRow key={s.id} specialist={s} />
          ))}
        </div>
      </div>
    </InspectorSection>
  );
}

/** Squads (A10, Q23): each squad with its agents and status line, the shared roles apart. It replaces the Team view. */
export function SquadsView() {
  const project = useUi((s) => s.app?.project)!;
  const document = project.document;
  const team = document.team;
  const pending = team.proposals.find((p) => !p.resolution);
  const former = team.specialists.filter((s) => s.status === "removed");
  const squads = teamSquads(document);
  const outside = developersOutsideSquads(document);
  const limits = squadLimits(document);
  return (
    <>
      <InspectorSection title="Le squadre del progetto">
        <p className="text-ui-sm text-muted-foreground">
          Ogni squadra si prende il lavoro di un'area del prodotto: ha un capo squadra, da uno a {limits.developersPerSquad} sviluppatori al lavoro e un QA
          dedicato. Il Coordinatore forma le squadre dopo lo studio, dalle aree della Mappa, e dirige tutte le squadre; tu decidi il prodotto. Lavorano
          insieme al massimo {limits.activeSquads === 1 ? "una squadra" : `${limits.activeSquads} squadre`}: i limiti si cambiano nelle impostazioni.
        </p>
        <p className="mt-2 text-ui-sm text-muted-foreground">
          Alcuni ruoli condivisi si attivano da soli, con regole di Trama e sul modello più leggero: il bug triage smista le issue nuove, diagnostica i test
          che falliscono e corregge il bug riprodotto; Clean Code rivede l'architettura quando le squadre sono libere e ti propone i miglioramenti in una
          scheda del Patto.
          {project.isDemo ? " Nel progetto di esempio restano ferme." : document.mandate?.status === "granted" ? "" : " Si attivano quando concedi un mandato."}
        </p>
      </InspectorSection>
      <AutomaticWorkSection />
      {pending ? (
        <InspectorSection title="Proposta in attesa">
          <TeamProposalCard proposalId={pending.id} />
        </InspectorSection>
      ) : null}
      {squads.map((squad) => (
        <SquadSection key={squad.id} squad={squad} />
      ))}
      {!squads.length || outside.length ? (
        <InspectorSection title={squads.length ? "Sviluppatori fuori dalle squadre" : "Sviluppatori"}>
          <p className="text-ui-sm text-muted-foreground">
            {squads.length
              ? "Le squadre sono al completo: entrano in una squadra quando si libera un posto o quando alzi il limite."
              : team.confirmedAt !== null
                ? "Il Coordinatore forma le squadre dopo lo studio, dalle aree della Mappa con lavoro previsto."
                : "Il Coordinatore li propone alla fine dello studio, poi forma le squadre dalle aree della Mappa."}
          </p>
          <div className="-mx-2 mt-1 flex flex-col gap-0.5">
            {outside.map((specialist) => (
              <DeveloperRow key={specialist.id} specialist={specialist} />
            ))}
          </div>
        </InspectorSection>
      ) : null}
      <InspectorSection title="Ruoli condivisi">
        <p className="text-ui-sm text-muted-foreground">Servono tutte le squadre, ognuno nel suo momento del lavoro. Ci sono sempre e non si tolgono.</p>
        <div className="-mx-2 mt-1 flex flex-col gap-0.5" data-testid="shared-roles">
          {sharedRoleMembers(document).map((specialist) => (
            <MemberRow key={specialist.id} specialist={specialist} />
          ))}
        </div>
      </InspectorSection>
      {former.length ? (
        <InspectorSection title="Usciti dal team">
          {former.map((s) => (
            <p key={s.id} className="text-ui-sm text-muted-foreground">
              {s.name}<Sep />{s.removal?.reason}
            </p>
          ))}
        </InspectorSection>
      ) : null}
    </>
  );
}

export function SpecialistView({ id }: { id: string }) {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const askCoordinator = useUi((s) => s.askCoordinator);
  const [removing, setRemoving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [reason, setReason] = useState("");
  const specialist = project.document.team.specialists.find((s) => s.id === id);
  if (!specialist) return <div className="p-4"><EmptyNote>Specialista non trovato.</EmptyNote></div>;
  const current = specialist.assignments.at(-1);
  const busy = current && ["preparing", "running", "stopRequested"].includes(current.status);
  const fixed = isFixedRole(specialist.role);
  // The question goes to the dialog of the goal the latest assignment serves; otherwise to the dialog on screen.
  const ask = () => {
    const goalId = findGoal(project.document, current?.goalId ?? null)?.id;
    askCoordinator(specialistQuestion(specialist, current ?? null), goalId ? { goalId } : {});
  };
  return (
    <>
      <div className="px-4 pt-3">
        <button type="button" className="inline-flex items-center gap-1 text-ui-sm text-muted-foreground hover:text-foreground" onClick={() => setInspector({ kind: "team" })}>
          <IconArrowLeft className="size-3.5" /> Squadre
        </button>
        {/* The bot sits beside the header, so it takes no room from the name and the status; the row wraps before
            anything is cut, and the status never shrinks. */}
        <div className="mt-2 flex items-start gap-3" data-testid="specialist-header">
          <AgentAvatar agent={specialist} size={48} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="min-w-0 max-w-full truncate text-ui-lg font-medium text-foreground" title={specialist.name}>
                {specialist.name}
              </h3>
              <AgentTag agent={specialist} className="text-ui-sm" />
              <Badge>{specialist.id}</Badge>
              <span className="ml-auto flex shrink-0 items-center gap-1.5 whitespace-nowrap text-ui-sm text-muted-foreground" data-testid="specialist-status">
                <StatusDot status={specialist.status} /> {STATUS_LABEL[specialist.status]}
              </span>
            </div>
            <p className="mt-0.5 text-ui text-muted-foreground">{specialist.competence}</p>
          </div>
        </div>
        <div className="cta-row mt-3">
          {specialist.status !== "removed" && !fixed ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setRenaming(!renaming);
                setRemoving(false);
              }}
            >
              Rinomina
            </Button>
          ) : null}
          {specialist.status !== "removed" && !busy && !fixed ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setRemoving(!removing);
                setRenaming(false);
              }}
            >
              Togli dal team
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={ask}>
            <IconMessageCircle stroke={1.8} /> Chiedi al Coordinatore
          </Button>
        </div>
        {renaming ? <RenameSpecialist specialist={specialist} onDone={() => setRenaming(false)} /> : null}
        {removing ? (
          <div className="mt-2 space-y-2">
            <TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo" className="min-h-12" />
            <Button className="ml-auto flex"
              size="sm"
              variant="destructive"
              disabled={!reason.trim()}
              onClick={() => void act("specialist:remove", { specialistId: specialist.id, reason: reason.trim() }).then(() => setRemoving(false))}
            >
              Togli {specialist.name}
            </Button>
          </div>
        ) : null}
      </div>
      {specialist.status !== "removed" ? <AgentColorPicker specialist={specialist} /> : null}
      <SpecialistThreads specialistId={specialist.id} />
      <InspectorSection title="Perché è nel team">
        <p className="text-ui text-foreground/90">{specialist.reason}</p>
        <p className="mt-1 text-ui-sm text-muted-foreground" data-testid="specialist-squad">{squadLine(project.document, specialist)}</p>
        <p className="mt-1 text-ui-xs text-muted-foreground">
          {specialist.origin === "fixedRole" ? "Ruolo fisso, non si toglie dal team" : specialist.origin === "teamProposal" ? "Dalla proposta confermata" : "Aggiunto dal Coordinatore"}
          <Sep />
          {formatRelativeTime(specialist.createdAt)}
        </p>
      </InspectorSection>
      <InspectorSection title="Quando interviene">
        <div className="flex flex-col gap-1.5">
          {roleDuties(specialist.role).map((duty) => (
            <div key={duty.moment}>
              <span className="block text-ui text-foreground/90">
                {TEAM_MOMENTS.find((m) => m.moment === duty.moment)!.label}
                <Sep />
                {duty.task}
              </span>
              <SkillList skills={duty.skills} />
            </div>
          ))}
        </div>
      </InspectorSection>
      {fixed ? <AutomaticWorkSection role={specialist.role} /> : null}
      {current && ["stopped", "failed"].includes(current.status) ? <AssignmentProvider assignment={current} /> : null}
      {current?.workspace && !current.workspaceRemovedAt && ["stopped", "failed", "completed"].includes(current.status) ? (
        <InspectorSection title="Copia di lavoro">
          <p className="text-ui-sm text-muted-foreground">
            <span className="font-mono">{current.workspace.branch}</span>. Trama lo rimuove solo se non perdi lavoro: nessuna modifica fuori da un commit e commit già pubblicati.
          </p>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => void act("assignment:removeWorktree", { assignmentId: current.id })}>
            Rimuovi la copia di lavoro
          </Button>
        </InspectorSection>
      ) : null}
      {project.document.candidates.some((c) => c.specialistId === specialist.id) ? (
        <InspectorSection title="Candidati">
          {project.document.candidates
            .filter((c) => c.specialistId === specialist.id)
            .reverse()
            .map((c) => (
              <CandidateCard key={c.id} candidateId={c.id} />
            ))}
        </InspectorSection>
      ) : null}
      <InspectorSection title={`Incarichi (${specialist.assignments.length})`}>
        {specialist.assignments.length === 0 ? <EmptyNote>Nessun incarico.</EmptyNote> : null}
        {[...specialist.assignments].reverse().map((assignment) =>
          assignment.id === current?.id ? (
            <AssignmentCard key={assignment.id} assignmentId={assignment.id} />
          ) : (
            <div key={assignment.id} className="flex items-center gap-2 py-1 text-ui-sm" title={assignment.id}>
              <span className="min-w-0 flex-1 truncate text-foreground/90" title={assignment.modelReason ?? undefined}>
                {assignment.objective}
                <span className="text-muted-foreground">
                  {" "}
                  <Sep />{providerLabel(assignment.provider ?? "codex")} {assignment.model}
                  {assignment.goalId ? `, ${findGoal(project.document, assignment.goalId)?.title ?? assignment.goalId}` : ""}
                </span>
              </span>
              <Badge tone={ASSIGNMENT_STATUS[assignment.status].tone}>{ASSIGNMENT_STATUS[assignment.status].label}</Badge>
            </div>
          ),
        )}
      </InspectorSection>
    </>
  );
}

/** Where the agent sits among the squads (A10): its squad and its part in it, or the shared roles. */
function squadLine(document: Parameters<typeof squadOf>[0], specialist: Specialist): string {
  const squad = squadOf(document, specialist.id);
  if (squad) {
    const part = squad.leadId === specialist.id ? "capo squadra" : squad.qaId === specialist.id ? "QA dedicato" : "sviluppatore";
    return `Squadra ${squad.name}, ${part}.`;
  }
  if (specialist.role === "developer") return teamSquads(document).length ? "Fuori dalle squadre, finché non si libera un posto." : "Le squadre non sono ancora formate.";
  return "Ruolo condiviso: serve tutte le squadre.";
}

const providerLabel = (id: ProviderId) => PROVIDERS.find((p) => p.id === id)?.name ?? id;

const nameKey = (name: string) => name.trim().toLocaleLowerCase("it").replace(/\s+/g, " ");

/** The person renames a developer (W13): the id stays, so assignments, chat and history follow the new name. */
function RenameSpecialist({ specialist, onDone }: { specialist: Specialist; onDone: () => void }) {
  const specialists = useUi((s) => s.app?.project?.document.team.specialists ?? []);
  const [name, setName] = useState(specialist.name);
  const next = name.trim();
  const taken = specialists.some((s) => s.id !== specialist.id && s.status !== "removed" && nameKey(s.name) === nameKey(next));
  const fixedName = FIXED_ROLES.some((role) => nameKey(roleProfile(role).name) === nameKey(next));
  const unchanged = next === specialist.name;
  const save = () => void act("specialist:rename", { specialistId: specialist.id, name: next }).then(onDone);
  return (
    <div className="mt-2 space-y-2" data-testid="rename-specialist">
      <Input
        autoFocus
        aria-label="Nuovo nome"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && next && !taken && !fixedName && !unchanged) save();
          if (e.key === "Escape") onDone();
        }}
      />
      {taken ? <p className="text-ui-sm text-muted-foreground">Nel team c'è già qualcuno con questo nome.</p> : null}
      {fixedName ? <p className="text-ui-sm text-muted-foreground">È il nome di un ruolo fisso del team: scegline un altro.</p> : null}
      <p className="text-ui-xs text-muted-foreground">L'ID {specialist.id} resta lo stesso: incarichi, chat e cronologia mostrano il nuovo nome.</p>
      <div className="cta-row">
        <Button size="sm" variant="ghost" onClick={onDone}>
          Annulla
        </Button>
        <Button size="sm" disabled={!next || taken || fixedName || unchanged} onClick={save}>
          Rinomina
        </Button>
      </div>
    </div>
  );
}

/** The agent's color (W15): Trama picked a free one; the person may choose another from the palette. */
function AgentColorPicker({ specialist }: { specialist: Specialist }) {
  return (
    <InspectorSection title="Colore">
      <p className="text-ui-sm text-muted-foreground">Il colore sta solo sul bot e sul tag. Badge e schede restano sui colori di stato.</p>
      <div className="mt-2 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Colore dell'agente">
        {AGENT_PALETTE.map((entry) => {
          const selected = entry.color === specialist.color;
          return (
            <Tooltip key={entry.color} label={entry.label}>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={entry.label}
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
    </InspectorSection>
  );
}

/** The person changes the provider of a stopped assignment (ADR 0009): assignment and worktree stay. */
function AssignmentProvider({ assignment }: { assignment: SpecialistAssignment }) {
  const providers = useUi((s) => s.app!.providers);
  const current = assignment.provider ?? "codex";
  const [provider, setProvider] = useState<ProviderId>(current);
  const models = providers[provider]?.models ?? [];
  const [model, setModel] = useState(assignment.model);
  const connected = PROVIDERS.map((p) => p.id as ProviderId).filter((id) => isUsableAccount(providers[id]?.account));
  const validModel = models.length === 0 || models.some((m) => m.model === model);
  const unchanged = provider === current && model === assignment.model;
  return (
    <InspectorSection title="Provider dell'incarico">
      <p className="text-ui-sm text-muted-foreground">
        Ora: {providerLabel(current)}<Sep />{assignment.model}. Puoi cambiarlo prima della ripresa: incarico e copia di lavoro restano, riparte solo la sessione.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-ui-sm">
        <PickerSelect
          label="Provider"
          value={provider}
          options={connected.map((id) => ({ value: id, title: providerLabel(id), icon: <ProviderIcon provider={id} /> }))}
          onChange={(next) => {
            setProvider(next);
            setModel(providers[next]?.models.find((m) => m.isDefault)?.model ?? providers[next]?.models[0]?.model ?? "");
          }}
        />
        <PickerSelect
          label="Modello"
          value={model}
          title={providerLabel(provider)}
          meta={models.length === 1 ? "1 modello" : `${models.length} modelli`}
          searchPlaceholder="Cerca un modello"
          className="flex-1"
          options={[
            ...(!validModel ? [{ value: model, title: `${model} (non disponibile)`, disabled: true }] : []),
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
          Cambia
        </Button>
      </div>
    </InspectorSection>
  );
}

/** Every conversation between agents the specialist takes part in (W07), the most recent first. */
function SpecialistThreads({ specialistId }: { specialistId: string }) {
  const document = useUi((s) => s.app?.project?.document);
  const setInspector = useUi((s) => s.setInspector);
  const threads = agentThreadsByRecent(document?.agentThreads ?? []).filter((t) => t.specialistIds.includes(specialistId));
  if (!document || !threads.length) return null;
  return (
    <InspectorSection title={`Chat tra agenti (${threads.length})`}>
      <div className="flex flex-col gap-1" data-testid="specialist-threads">
        {threads.map((thread) => (
          <button
            key={thread.id}
            type="button"
            className="flex min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left text-ui hover:bg-[var(--sidebar-accent)]"
            onClick={() => setInspector({ kind: "agentThread", id: thread.id })}
          >
            <span className="min-w-0 flex-1 truncate text-foreground/90">{thread.title}</span>
            <span className="shrink-0 text-ui-xs text-muted-foreground">{threadParticipants(thread, document.team.specialists)}</span>
          </button>
        ))}
      </div>
    </InspectorSection>
  );
}
