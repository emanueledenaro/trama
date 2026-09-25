import { IconArrowLeft } from "@tabler/icons-react";
import { useState } from "react";
import { isUsableAccount, type ProviderId } from "@shared/codex";
import type { Specialist, SpecialistAssignment } from "@shared/domain";
import { findGoal } from "@shared/goals";
import { PROVIDERS } from "@shared/providers";
import { AGENT_PALETTE } from "@shared/identity";
import { FIXED_ROLES, isFixedRole, roleDuties, roleProfile, type RosterFigure, TEAM_MOMENTS, teamRoster } from "@shared/roster";
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
        status === "available" && "bg-success",
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
      <span className="mt-0.5 flex w-4 justify-center">
        <AgentAvatar agent={specialist} />
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

/** A fixed role at one moment: what it does there and with which skills; it opens the specialist. */
function FigureRow({ figure }: { figure: RosterFigure }) {
  const setInspector = useUi((s) => s.setInspector);
  const specialist = figure.specialists[0];
  const body = (
    <>
      <span className="mt-0.5 flex w-4 justify-center">{specialist ? <AgentAvatar agent={specialist} /> : null}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-ui text-foreground">
          {specialist ? <AgentName agent={specialist} avatar={false} /> : figure.profile.name}
          {specialist && specialist.status !== "available" ? <StatusDot status={specialist.status} /> : null}
        </span>
        <span className="block text-ui-sm text-muted-foreground">{figure.duty.task}</span>
        {specialist && specialist.status !== "available" ? (
          <span className="block truncate text-ui-sm text-muted-foreground">
            {STATUS_LABEL[specialist.status]}<Sep />{specialist.lastUpdate}
          </span>
        ) : null}
        <SkillList skills={figure.duty.skills} />
      </span>
    </>
  );
  if (!specialist) return <div className="flex items-start gap-2 px-2 py-1.5">{body}</div>;
  return (
    <button type="button" data-testid="team-figure" onClick={() => setInspector({ kind: "specialist", id: specialist.id })} className={ROW}>
      {body}
    </button>
  );
}

/** The developers' place in the flow, with each developer chosen for the project below it. */
function DevelopersFigure({ figure, confirmed }: { figure: RosterFigure; confirmed: boolean }) {
  return (
    <div className="px-2 py-1.5">
      <span className="block text-ui text-foreground">{figure.profile.name}</span>
      <span className="block text-ui-sm text-muted-foreground">{figure.duty.task}</span>
      <SkillList skills={figure.duty.skills} />
      <div className="-mx-2 mt-1 flex flex-col gap-0.5 pl-3">
        {figure.specialists.length === 0 ? (
          <p className="px-2 text-ui-sm text-muted-foreground/70">
            {confirmed ? "Nessuno sviluppatore attivo." : "Il Coordinatore li propone alla fine dello studio."}
          </p>
        ) : null}
        {figure.specialists.map((specialist) => (
          <DeveloperRow key={specialist.id} specialist={specialist} />
        ))}
      </div>
    </div>
  );
}

export function TeamView() {
  const project = useUi((s) => s.app?.project)!;
  const team = project.document.team;
  const pending = team.proposals.find((p) => !p.resolution);
  const former = team.specialists.filter((s) => s.status === "removed");
  return (
    <>
      <InspectorSection title="Il team del progetto">
        <p className="text-ui-sm text-muted-foreground">
          Ogni progetto ha tutte le figure di un team di sviluppo, ognuna nel suo momento del lavoro. Tu decidi il prodotto e il Coordinatore guida il
          team. Gli sviluppatori li propone il Coordinatore alla fine dello studio e li crea solo la tua risposta; le altre figure ci sono sempre.
        </p>
        <p className="mt-2 text-ui-sm text-muted-foreground">
          Alcune figure si attivano da sole, con regole di Trama e sul modello più leggero: il bug triage smista le issue nuove, diagnostica i test
          che falliscono e corregge il bug riprodotto; Clean Code rivede l'architettura quando il team è libero e ti propone i miglioramenti in una
          scheda del Patto.
          {project.isDemo ? " Nel progetto di esempio restano ferme." : project.document.mandate?.status === "granted" ? "" : " Si attivano quando concedi un mandato."}
        </p>
      </InspectorSection>
      {pending ? (
        <InspectorSection title="Proposta in attesa">
          <TeamProposalCard proposalId={pending.id} />
        </InspectorSection>
      ) : null}
      {teamRoster(team).map((moment) => (
        <InspectorSection key={moment.moment} title={moment.label}>
          <p className="text-ui-sm text-muted-foreground">{moment.when}</p>
          <div className="-mx-2 mt-1 flex flex-col gap-0.5">
            {moment.figures.map((figure) =>
              figure.profile.role === "developer" ? (
                <DevelopersFigure key={figure.profile.role} figure={figure} confirmed={team.confirmedAt !== null} />
              ) : (
                <FigureRow key={figure.profile.role} figure={figure} />
              ),
            )}
          </div>
        </InspectorSection>
      ))}
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
  const focusComposer = useUi((s) => s.focusComposer);
  const [removing, setRemoving] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [reason, setReason] = useState("");
  const specialist = project.document.team.specialists.find((s) => s.id === id);
  if (!specialist) return <div className="p-4"><EmptyNote>Specialista non trovato.</EmptyNote></div>;
  const current = specialist.assignments.at(-1);
  const busy = current && ["preparing", "running", "stopRequested"].includes(current.status);
  const fixed = isFixedRole(specialist.role);
  return (
    <>
      <div className="px-4 pt-3">
        <button type="button" className="inline-flex items-center gap-1 text-ui-sm text-muted-foreground hover:text-foreground" onClick={() => setInspector({ kind: "team" })}>
          <IconArrowLeft className="size-3.5" /> Team
        </button>
        <div className="mt-2 flex items-center gap-2">
          <AgentAvatar agent={specialist} className="size-5 text-ui-xs" />
          <h3 className="text-ui-lg font-medium text-foreground">{specialist.name}</h3>
          <AgentTag agent={specialist} className="text-ui-sm" />
          <Badge>{specialist.id}</Badge>
          <span className="ml-auto flex items-center gap-1.5 text-ui-sm text-muted-foreground">
            <StatusDot status={specialist.status} /> {STATUS_LABEL[specialist.status]}
          </span>
        </div>
        <p className="mt-0.5 text-ui text-muted-foreground">{specialist.competence}</p>
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
          <Button size="sm" variant="outline" onClick={() => focusComposer()}>
            Vai alla conversazione
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
      <InspectorSection title="Perché è nel team">
        <p className="text-ui text-foreground/90">{specialist.reason}</p>
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
      {current && ["stopped", "failed"].includes(current.status) ? <AssignmentProvider assignment={current} /> : null}
      {current?.workspace && !current.workspaceRemovedAt && ["stopped", "failed", "completed"].includes(current.status) ? (
        <InspectorSection title="Worktree">
          <p className="text-ui-sm text-muted-foreground">
            <span className="font-mono">{current.workspace.branch}</span>. Trama lo rimuove solo se non perdi lavoro: nessuna modifica fuori da un commit e commit già pubblicati.
          </p>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => void act("assignment:removeWorktree", { assignmentId: current.id })}>
            Rimuovi il worktree
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
            <div key={assignment.id} className="flex items-center gap-2 py-1 text-ui-sm">
              <span className="font-mono text-[11px] text-muted-foreground">{assignment.id}</span>
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
      <p className="text-ui-sm text-muted-foreground">Il colore sta solo sull'avatar e sul tag. Badge e schede restano sui colori di stato.</p>
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
                  "agent-identity agent-avatar size-6 text-ui-xs transition-shadow",
                  selected ? "ring-2 ring-[var(--agent)] ring-offset-1 ring-offset-background" : "hover:ring-1 hover:ring-[var(--agent)]",
                )}
                style={agentStyle({ color: entry.color })}
                onClick={() => (selected ? undefined : void act("specialist:setColor", { specialistId: specialist.id, color: entry.color }))}
              >
                {[...specialist.name.trim()][0]?.toLocaleUpperCase("it") ?? "?"}
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
        Ora: {providerLabel(current)}<Sep />{assignment.model}. Puoi cambiarlo prima della ripresa: incarico e worktree restano, riparte solo la sessione.
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
