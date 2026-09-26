import {
  IconBook2,
  IconBriefcase,
  IconCircleCheck,
  IconCircleX,
  IconFileDiff,
  IconGitPullRequest,
  IconListCheck,
  IconChevronRight,
  IconGitBranch,
  IconInfoCircle,
  IconRosetteDiscountCheck,
  IconShieldCheck,
  IconTelescope,
  IconUsersGroup,
  IconUsers,
} from "@tabler/icons-react";
import { type AssignmentStatus, type CandidateEvidence, type CandidateState, type TestedSeam, isOpenQuestion } from "@shared/domain";
import { isExerciseAssessment } from "@shared/onboarding";
import { findGoal } from "@shared/goals";
import { adrMarkdown, adrPath, findDomainProposal, glossaryEntry } from "@shared/domainDocs";
import { PROVIDERS } from "@shared/providers";
import type { ActionResult } from "@shared/ipc";
import { Spinner } from "@/components/Spinner";
import { useState } from "react";
import type * as React from "react";
import { Button } from "@/components/ui/button";
import { Badge, TextArea } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { act, useUi } from "@/lib/store";
import { ACTION_LABELS } from "@/lib/labels";
import { ChatMarkdown } from "./ChatMarkdown";
import { PlanSpecBody } from "./PlanSpec";
import { DutyFields } from "./DutyFields";
import { Sep } from "@/components/ui/sep";
import { AgentName } from "@/components/AgentIdentity";
import { OverlapRow } from "@/components/OverlapNotice";
import { compareSides, linesLabel, type OverlapItem } from "@shared/overlap";

function CardFrame({
  icon,
  title,
  aside,
  children,
  className,
  anchor,
}: {
  icon: React.ReactNode;
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Lets the exercise guide find the card in the timeline. */
  anchor?: string;
}) {
  return (
    <div data-anchor={anchor} className={cn("chat-card my-3 overflow-hidden", className)}>
      <div className="flex items-center gap-2 px-3.5 pt-2.5 pb-1 text-ui">
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground [&>svg]:size-3.5">{icon}</span>
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{title}</span>
        {aside}
      </div>
      <div className="px-3.5 pb-3">{children}</div>
    </div>
  );
}

/** The provider's name; an absent provider is Codex, as in documents written before providers. */
const providerLabel = (id: string | undefined | null) => PROVIDERS.find((p) => p.id === (id ?? "codex"))?.name ?? id ?? "Codex";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      <div className="text-ui-xs text-muted-foreground/70">{label}</div>
      <div className="mt-0.5 text-ui text-foreground/90">{children}</div>
    </div>
  );
}

export function StudyCard({ title, text, streaming }: { title: string; text: string; streaming: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <CardFrame
      anchor={streaming ? undefined : "study"}
      icon={<IconTelescope stroke={1.8} />}
      title={title}
      aside={
        streaming ? (
          <span className="shimmer-text text-ui-sm">Il Coordinatore sta studiando il progetto</span>
        ) : (
          <button type="button" onClick={() => setOpen(!open)} className="sidebar-icon-button size-5" aria-label={open ? "Comprimi" : "Espandi"}>
            <IconChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          </button>
        )
      }
    >
      {streaming && !text ? (
        <p className="text-ui text-muted-foreground">Lettura di codice, istruzioni, Patto e mandato…</p>
      ) : open ? (
        <ChatMarkdown text={text} />
      ) : (
        <p className="line-clamp-2 text-ui text-muted-foreground">{text}</p>
      )}
      {streaming ? (
        <div className="cta-row mt-2">
          <Button variant="outline" size="xs" onClick={() => void act("coordinator:interrupt", undefined)}>
            Interrompi
          </Button>
        </div>
      ) : null}
    </CardFrame>
  );
}

export function ContextNoticeCard({ title, detail }: { title: string; detail: string | null }) {
  return (
    <div className="my-3 flex items-start gap-2 rounded-xl bg-[var(--color-background-button-secondary)] px-3.5 py-2.5 text-ui">
      <IconInfoCircle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div>
        <div className="text-foreground/90">{title}</div>
        {detail ? <div className="text-ui-sm text-muted-foreground">{detail}</div> : null}
      </div>
    </div>
  );
}

export function MandateCard({ requestId }: { requestId: string }) {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const [revoking, setRevoking] = useState(false);
  const [reason, setReason] = useState("");
  const request = project.document.mandateRequests.find((r) => r.id === requestId);
  if (!request) return null;
  const moduleName = (id: string) => project.snapshot.modules.find((m) => m.id === id)?.name ?? id;
  const resolution = request.resolution;
  const hasMandate = project.document.mandate?.status === "granted";
  // A newer request replaced this one before the person answered (W14): grey, kept in the history, not grantable.
  const superseded = resolution?.kind === "superseded";

  return (
    <CardFrame
      icon={<IconShieldCheck stroke={1.8} />}
      title="Mandato"
      className={cn(superseded && "opacity-60")}
      aside={
        resolution ? (
          <Badge tone={resolution.kind === "revoked" || superseded ? "secondary" : "success"}>
            {resolution.kind === "granted"
              ? `Concesso, v${resolution.version}`
              : resolution.kind === "corrected"
                ? `Corretto, v${resolution.version}`
                : superseded
                  ? "Superata"
                  : "Non concesso"}
          </Badge>
        ) : (
          <Badge tone="info">In attesa</Badge>
        )
      }
    >
      <p className="text-ui text-foreground/90">{request.reason}</p>
      {superseded ? (
        <p className="mt-1 text-ui-sm text-muted-foreground" data-testid="superseded-mandate">
          Superata dalla richiesta {resolution.supersededBy ?? "più recente"}: non si può più concedere.
        </p>
      ) : null}
      <Field label="Obiettivi">
        <ul className="list-disc pl-4">
          {request.objectives.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
      </Field>
      {request.priorities.length ? <Field label="Priorità">{request.priorities.join(", ")}</Field> : null}
      <Field label="Perimetro">{request.scopeModuleIds.map(moduleName).join(", ")}</Field>
      <Field label="Azioni autorizzate">{request.authorizedActions.map((a) => ACTION_LABELS[a]).join(", ")}</Field>
      {request.limits.length ? <Field label="Limiti">{request.limits.join(", ")}</Field> : null}
      {!resolution ? (
        revoking ? (
          <div className="mt-3 space-y-2">
            <TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo" aria-label="Motivo della revoca" />
            <div className="cta-row">
              <Button
                size="sm"
                variant="destructive"
                disabled={!reason.trim()}
                onClick={() => void act("mandate:revoke", { reason: reason.trim(), requestId })}
              >
                {hasMandate ? "Revoca il mandato" : "Non concedere"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRevoking(false)}>
                Annulla
              </Button>
            </div>
          </div>
        ) : (
          <div className="cta-row mt-3">
            <Button
              size="sm"
              onClick={() =>
                void act("mandate:grant", {
                  requestId,
                  objectives: request.objectives,
                  priorities: request.priorities,
                  scopeModuleIds: request.scopeModuleIds,
                  authorizedActions: request.authorizedActions,
                  limits: request.limits,
                })
              }
            >
              {hasMandate ? "Accetta la proposta" : "Concedi"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setInspector({ kind: "mandate" })}>
              Correggi
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRevoking(true)}>
              {hasMandate ? "Revoca" : "Non concedere"}
            </Button>
          </div>
        )
      ) : null}
    </CardFrame>
  );
}

export function DecisionCard({ requestId }: { requestId: string }) {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const [choice, setChoice] = useState<number | null>(null);
  const [freeText, setFreeText] = useState("");
  // Withdrawing asks for a reason first: the step that confirms an action the person cannot undo.
  const [withdrawing, setWithdrawing] = useState(false);
  const [reason, setReason] = useState("");
  const request = project.document.decisionRequests.find((r) => r.id === requestId);
  if (!request) return null;
  const outcome = request.outcome;
  const withdrawal = request.withdrawal ?? null;
  const closed = Boolean(outcome || withdrawal);
  const grilling = request.grilling ?? null;

  return (
    <CardFrame
      icon={<IconRosetteDiscountCheck stroke={1.8} />}
      title={grilling ? `Domanda ${grilling.number}` : "Decisione"}
      className={grilling ? "my-2" : undefined}
      aside={
        withdrawal ? (
          <Badge tone="secondary">Ritirata</Badge>
        ) : (
          <Badge tone={request.category === "destructive" ? "destructive" : "info"}>{request.category === "destructive" ? "Caso distruttivo" : "Scelta di prodotto"}</Badge>
        )
      }
    >
      <p className={cn("text-ui font-medium text-foreground", withdrawal && "text-foreground/70")}>{request.question}</p>
      <Field label="Caso concreto">{request.concreteCase}</Field>
      <div className="mt-3 space-y-1.5">
        {request.alternatives.map((alternative, index) => {
          const chosen = outcome ? outcome.alternativeIndex === index : !withdrawal && choice === index;
          return (
            <button
              key={alternative.behavior}
              type="button"
              disabled={closed}
              onClick={() => {
                setChoice(index);
                setFreeText("");
              }}
              className={cn(
                "block w-full rounded-lg border px-3 py-2 text-left transition-colors",
                chosen
                  ? "border-[color:var(--color-text-accent)] bg-[color-mix(in_srgb,var(--color-text-accent)_7%,transparent)]"
                  : "border-[color:var(--color-border)] hover:bg-[var(--color-background-button-secondary-hover)]",
                closed && !chosen && "opacity-60",
              )}
            >
              <div className="flex items-start gap-2">
                <span className="min-w-0 flex-1 text-ui text-foreground">{alternative.behavior}</span>
                {grilling?.recommendedIndex === index ? <Badge tone="success">Consigliata</Badge> : null}
              </div>
              <div className="mt-0.5 text-ui-sm text-muted-foreground">Esempio: {alternative.example}</div>
              {alternative.consequence ? <div className="mt-0.5 text-ui-sm text-muted-foreground">Conseguenza: {alternative.consequence}</div> : null}
            </button>
          );
        })}
      </div>
      {outcome ? (
        <div className="mt-3 flex items-center gap-2 text-ui-sm text-muted-foreground">
          <span>
            Decisione {outcome.decisionId}<Sep />versione {outcome.version}
          </span>
          <button type="button" className="text-[var(--color-text-accent)] hover:underline" onClick={() => setInspector({ kind: "decision", id: outcome.decisionId })}>
            Apri nel Patto
          </button>
          {outcome.alternativeIndex === null ? <span className="truncate"><Sep />«{outcome.answer}»</span> : null}
        </div>
      ) : withdrawal ? (
        <p className="mt-3 text-ui-sm text-muted-foreground" data-testid="withdrawn-question">
          Hai ritirato la domanda. Motivo: {withdrawal.reason}
          <Sep />
          Non è diventata una decisione e il Coordinatore ha ricevuto il motivo.
        </p>
      ) : withdrawing ? (
        <div className="mt-3 space-y-2">
          <TextArea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Perché la ritiri? Il Coordinatore legge il motivo."
            aria-label="Motivo del ritiro"
            className="min-h-12"
            autoFocus
          />
          <p className="text-ui-xs text-muted-foreground">La domanda resta nella cronologia, non diventa una decisione e non blocca più il piano.</p>
          <div className="cta-row">
            <Button size="sm" variant="ghost" onClick={() => setWithdrawing(false)}>
              Annulla
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={!reason.trim()}
              onClick={() => void act("decision:withdraw", { requestId, reason: reason.trim() })}
            >
              Ritira la domanda
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <TextArea
            value={freeText}
            onChange={(event) => {
              setFreeText(event.target.value);
              if (event.target.value) setChoice(null);
            }}
            placeholder="Oppure rispondi con parole tue"
            aria-label="La tua decisione"
            className="min-h-12"
          />
          <div className="cta-row">
            <Button size="sm" variant="ghost" onClick={() => setWithdrawing(true)}>
              Ritira
            </Button>
            <Button
              size="sm"
              disabled={choice === null && !freeText.trim()}
              onClick={() =>
                void act("decision:answer", {
                  requestId,
                  alternativeIndex: choice,
                  freeText: choice === null ? freeText.trim() : null,
                })
              }
            >
              Registra la decisione
            </Button>
          </div>
        </div>
      )}
    </CardFrame>
  );
}

/** The questions of one grilling round (M01), together under the round they belong to. */
export function GrillingRoundCard({ round, questionIds }: { round: number; questionIds: string[] }) {
  const project = useUi((s) => s.app?.project)!;
  const questions = questionIds.map((id) => project.document.decisionRequests.find((r) => r.id === id)).filter((r) => r !== undefined);
  // A withdrawn question is closed without an answer: it no longer counts among the answers the round waits for.
  const asked = questions.filter((q) => !q.withdrawal);
  const answered = asked.filter((q) => q.outcome).length;
  const withdrawn = questions.length - asked.length;
  const complete = answered === asked.length;
  return (
    <section aria-label={`Chiarimento, turno ${round}`} className="my-3 rounded-xl border border-dashed border-[color:var(--color-border)] px-2.5 pt-2 pb-0.5">
      <div className="flex items-center gap-2 px-1 text-ui-sm">
        <IconListCheck className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">Chiarimento prima del piano, turno {round}</span>
        {withdrawn ? <Badge tone="secondary">{withdrawn === 1 ? "1 ritirata" : `${withdrawn} ritirate`}</Badge> : null}
        <Badge tone={complete ? "success" : "info"}>
          {complete ? "Turno completo" : `${answered} di ${asked.length} risposte`}
        </Badge>
      </div>
      {questions.map((q) => (
        <DecisionCard key={q.id} requestId={q.id} />
      ))}
    </section>
  );
}

export const ASSIGNMENT_STATUS: Record<AssignmentStatus, { label: string; tone: "info" | "success" | "warning" | "destructive" | "secondary" }> = {
  preparing: { label: "In preparazione", tone: "info" },
  running: { label: "Al lavoro", tone: "info" },
  stopRequested: { label: "Arresto richiesto", tone: "warning" },
  stopped: { label: "Fermato", tone: "secondary" },
  completed: { label: "Concluso", tone: "success" },
  failed: { label: "Non riuscito", tone: "destructive" },
};

export function TeamProposalCard({ proposalId }: { proposalId: string }) {
  const project = useUi((s) => s.app?.project)!;
  const proposal = project.document.team.proposals.find((p) => p.id === proposalId);
  const [kept, setKept] = useState<string[] | null>(null);
  const [note, setNote] = useState("");
  if (!proposal) return null;
  const selected = kept ?? proposal.members.map((m) => m.name);
  const resolution = proposal.resolution;
  const moduleName = (id: string) => project.snapshot.modules.find((m) => m.id === id)?.name ?? id;
  const corrected = selected.length !== proposal.members.length || note.trim().length > 0;
  return (
    <CardFrame
      icon={<IconUsersGroup stroke={1.8} />}
      title="Proposta del team"
      aside={
        resolution ? (
          <Badge tone={resolution.kind === "superseded" ? "secondary" : "success"}>
            {resolution.kind === "confirmed" ? "Team confermato" : resolution.kind === "corrected" ? "Team corretto" : "Proposta sostituita"}
          </Badge>
        ) : (
          <Badge tone="info">In attesa</Badge>
        )
      }
    >
      {proposal.summary ? <p className="text-ui text-foreground/90">{proposal.summary}</p> : null}
      <p className="mt-1 text-ui-sm text-muted-foreground">Qui scegli gli sviluppatori. Le altre figure del team ci sono sempre.</p>
      <div className="mt-2 space-y-1.5">
        {proposal.members.map((member) => {
          const checked = selected.includes(member.name);
          return (
            <label
              key={member.name}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-lg border border-[color:var(--color-border)] px-3 py-2",
                resolution && "cursor-default",
                resolution && !checked && "opacity-60",
              )}
            >
              {!resolution ? (
                <input
                  type="checkbox"
                  className="mt-1 accent-[var(--color-text-accent)]"
                  checked={checked}
                  onChange={(e) => setKept(e.target.checked ? [...selected, member.name] : selected.filter((n) => n !== member.name))}
                />
              ) : null}
              <span className="min-w-0 flex-1">
                <span className="block text-ui text-foreground">
                  {member.name} <span className="text-muted-foreground"><Sep />{member.competence}</span>
                </span>
                <span className="block text-ui-sm text-muted-foreground">{member.reason}</span>
                {member.moduleIds.length ? (
                  <span className="block text-ui-xs text-muted-foreground/70">Moduli: {member.moduleIds.map(moduleName).join(", ")}</span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
      {resolution?.kind === "corrected" && resolution.note ? <Field label="Correzione">{resolution.note}</Field> : null}
      {!resolution ? (
        <div className="mt-3 space-y-2">
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Correzione (facoltativa)" aria-label="Correzione" className="min-h-12" />
          <Button className="ml-auto flex"
            size="sm"
            disabled={selected.length === 0}
            onClick={() =>
              void act("team:answer", {
                proposalId,
                keeping: selected.length === proposal.members.length ? null : selected,
                note: note.trim() || null,
              })
            }
          >
            {corrected ? "Conferma con le correzioni" : "Conferma il team"}
          </Button>
        </div>
      ) : null}
    </CardFrame>
  );
}

export function AssignmentCard({ assignmentId }: { assignmentId: string }) {
  const project = useUi((s) => s.app?.project)!;
  const specialist = project.document.team.specialists.find((s) => s.assignments.some((a) => a.id === assignmentId));
  const assignment = specialist?.assignments.find((a) => a.id === assignmentId);
  const [showResult, setShowResult] = useState(false);
  const setInspector = useUi((s) => s.setInspector);
  if (!specialist || !assignment) return null;
  const goal = findGoal(project.document, assignment.goalId);
  const lastTurn = assignment.turns.at(-1);
  const status = ASSIGNMENT_STATUS[assignment.status];
  const active = ["preparing", "running", "stopRequested"].includes(assignment.status);
  const isCurrent = specialist.assignments.at(-1)?.id === assignment.id;
  const moduleName = (id: string) => project.snapshot.modules.find((m) => m.id === id)?.name ?? id;
  return (
    <CardFrame
      icon={<IconBriefcase stroke={1.8} />}
      title={`Incarico ${assignment.id}`}
      aside={
        <span className="flex items-center gap-1.5">
          {active ? <Spinner /> : null}
          <Badge tone={status.tone}>{status.label}</Badge>
        </span>
      }
    >
      <Field label="Specialista">
        <AgentName agent={specialist} /> <span className="text-muted-foreground"><Sep />{specialist.competence}</span>
      </Field>
      <Field label="Obiettivo">{assignment.objective}</Field>
      <DutyFields assignment={assignment} />
      {assignment.exercise ? <Field label="Esercizio">{assignment.exercise}</Field> : null}
      <Field label="Perimetro">{assignment.moduleIds.length ? assignment.moduleIds.map(moduleName).join(", ") : "Tutto il progetto"}</Field>
      {assignment.dependencies.length ? <Field label="Dipendenze">{assignment.dependencies.join(", ")}</Field> : null}
      {goal ? (
        <Field label="Obiettivo del progetto">
          <button type="button" className="text-left text-[var(--color-text-accent)] hover:underline" onClick={() => setInspector({ kind: "goal", id: goal.id })}>
            {goal.title}
          </button>
        </Field>
      ) : null}
      <Field label="Provider e modello scelti all'assegnazione">
        {providerLabel(assignment.provider)}<Sep />{assignment.model}
        <div className="mt-0.5 text-ui-sm text-muted-foreground">
          {assignment.duty && assignment.modelReason
            ? assignment.modelReason
            : assignment.modelReason
              ? `Motivazione del Coordinatore: ${assignment.modelReason}`
              : "Il Coordinatore non ha registrato una motivazione per questa scelta."}
        </div>
        {lastTurn && (lastTurn.provider ?? "codex") !== (assignment.provider ?? "codex") ? (
          <div className="mt-0.5 text-ui-sm text-warning">Ultimo turno eseguito con {providerLabel(lastTurn.provider)}<Sep />{lastTurn.model}</div>
        ) : lastTurn && lastTurn.model !== assignment.model ? (
          <div className="mt-0.5 text-ui-sm text-warning">Ultimo turno eseguito con {lastTurn.model}</div>
        ) : null}
      </Field>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-ui-sm text-muted-foreground">
        <span>{assignment.tools.includes("edits") ? "Worktree proprio" : "Sola lettura"}</span>
        {assignment.requiredChecks.length ? <span>Verifiche: {assignment.requiredChecks.join(", ")}</span> : null}
      </div>
      {assignment.workspace ? (
        <div className="mt-1.5 flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
          <IconGitBranch className="size-3" /> {assignment.workspace.branch}
        </div>
      ) : null}
      <p className="mt-2 text-ui-sm text-muted-foreground">{assignment.lastUpdate}</p>
      {assignment.failure ? <Field label="Errore">{assignment.failure}</Field> : null}
      {assignment.result ? (
        <div className="mt-2">
          <button type="button" className="inline-flex items-center gap-1 text-ui-sm text-muted-foreground hover:text-foreground" onClick={() => setShowResult(!showResult)}>
            Risultato <IconChevronRight className={cn("size-3.5 transition-transform", showResult && "rotate-90")} />
          </button>
          {showResult ? (
            <div className="mt-1 rounded-lg bg-[var(--app-chat-code-surface)] px-3 py-2">
              <ChatMarkdown text={assignment.result} />
            </div>
          ) : null}
        </div>
      ) : null}
      {isCurrent && (active || assignment.status === "stopped" || assignment.status === "failed") ? (
        <div className="cta-row mt-3">
          {active ? (
            <Button size="sm" variant="outline" disabled={assignment.status === "stopRequested"} onClick={() => void act("assignment:stop", { assignmentId })}>
              Ferma
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => void act("assignment:resume", { assignmentId })}>
              Riprendi
            </Button>
          )}
        </div>
      ) : null}
    </CardFrame>
  );
}

/**
 * Glossary terms and ADRs the Coordinator drew from the person's decisions (M03), in the formats of the domain-modeling
 * skill. The Coordinator writes nothing: the documentation and domain role writes them within the mandate.
 */
export function DomainProposalCard({ proposalId }: { proposalId: string }) {
  const document = useUi((s) => s.app?.project?.document);
  const setInspector = useUi((s) => s.setInspector);
  const proposal = document ? findDomainProposal(document, proposalId) : null;
  if (!document || !proposal) return null;
  const assignment = proposal.assignmentId ? document.team.specialists.flatMap((s) => s.assignments).find((a) => a.id === proposal.assignmentId) : null;
  const written = assignment?.status === "completed";
  const writing = assignment ? ["preparing", "running", "stopRequested"].includes(assignment.status) : false;
  const status = written
    ? { label: "Scritta", tone: "success" as const }
    : writing
      ? { label: "In scrittura", tone: "info" as const }
      : assignment
        ? { label: "Scrittura ferma", tone: "warning" as const }
        : { label: "In attesa", tone: "secondary" as const };
  return (
    <CardFrame
      anchor="domain-proposal"
      icon={<IconBook2 stroke={1.8} />}
      title={`Glossario e ADR ${proposal.id}`}
      aside={<Badge tone={status.tone}>{status.label}</Badge>}
    >
      <div data-testid="domain-proposal">
        <Field label="Dalle decisioni del Patto">
          {proposal.decisionIds.map((id, index) => (
            <span key={id}>
              {index ? ", " : null}
              <button type="button" className="text-[var(--color-text-accent)] hover:underline" onClick={() => setInspector({ kind: "decision", id })}>
                {id}
              </button>
            </span>
          ))}
        </Field>
        {proposal.terms.length ? (
          <Field label={`Termini per ${proposal.contextPath}`}>
            <div className="mt-1 rounded-lg bg-[var(--app-chat-code-surface)] px-3 py-2">
              <ChatMarkdown text={proposal.terms.map(glossaryEntry).join("\n\n")} />
            </div>
          </Field>
        ) : null}
        {proposal.adrs.map((adr) => (
          <Field key={adr.title} label={`ADR ${adrPath(proposal, adr)}`}>
            <div className="mt-1 rounded-lg bg-[var(--app-chat-code-surface)] px-3 py-2">
              <ChatMarkdown text={adrMarkdown(adr)} />
            </div>
          </Field>
        ))}
        <p className="mt-2 text-ui-sm text-muted-foreground">
          {!assignment
            ? (proposal.waiting ?? "Il Coordinatore non scrive file: la proposta aspetta il mandato.")
            : written
              ? `Documentazione e dominio ha scritto la proposta nel worktree dell'incarico ${assignment.id}. La rivedi come candidato.`
              : writing
                ? `Documentazione e dominio la scrive nel worktree dell'incarico ${assignment.id}, con la skill domain-modeling.`
                : `L'incarico ${assignment.id} si è fermato prima di finire: lo trovi nella sua scheda.`}
        </p>
      </div>
    </CardFrame>
  );
}

export const CANDIDATE_STATE: Record<CandidateState, { label: string; tone: "info" | "success" | "secondary" }> = {
  building: { label: "In costruzione", tone: "secondary" },
  verified: { label: "Verificato", tone: "info" },
  decided: { label: "Deciso", tone: "success" },
};

const BLOCKER_TEXT: Record<string, string> = {
  BASE_CHANGED: "La base del progetto è cambiata",
  DECISION_CHANGED: "Una decisione è cambiata",
  UNRESOLVED_CHOICE: "Scelta non risolta",
  EXTERNAL_EFFECT_UNSUPPORTED: "Effetto esterno non supportato",
  EVIDENCE_MISSING: "Verifica da eseguire",
  EVIDENCE_STALE: "Verifica non più valida",
  CHECK_FAILED: "Verifica non superata",
  REMOTE_CONFLICT: "Conflitto con il lavoro di un collega",
};

/** One required check of a candidate; a failed one opens on the command and the original output Trama recorded (V05). */
function EvidenceRow({ check, evidence }: { check: string; evidence: CandidateEvidence | null }) {
  const [open, setOpen] = useState(false);
  const failed = evidence?.result === "fail";
  return (
    <div data-testid="candidate-evidence" data-check={check} data-result={evidence?.result ?? "missing"}>
      <div className="flex items-center gap-1.5 text-ui-sm">
        {evidence?.result === "pass" ? (
          <IconCircleCheck className="size-3.5 text-success" />
        ) : failed ? (
          <IconCircleX className="size-3.5 text-destructive" />
        ) : (
          <span className="inline-block size-3.5 rounded-full border border-dashed border-muted-foreground/50" />
        )}
        <span className="font-mono text-[11.5px]">{check}</span>
        <span className="text-muted-foreground">{evidence ? (evidence.result === "pass" ? "superata" : "non superata") : "non eseguita"}</span>
        {failed ? (
          <button
            type="button"
            aria-expanded={open}
            className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            onClick={() => setOpen(!open)}
          >
            Output originale <IconChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          </button>
        ) : null}
      </div>
      {failed && open ? (
        <div className="mt-1 rounded-lg bg-[var(--app-chat-code-surface)] px-3 py-2" data-testid="evidence-output">
          <p className="font-mono text-[11px] text-muted-foreground">{evidence.command}</p>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-[1.55] text-foreground/85">
            {evidence.output || "Il controllo non ha scritto niente."}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

/** The seams the developer of a slice says it tested (M06): its statement, shown apart from Trama's evidence. */
function TestedSeamsField({ seams }: { seams: TestedSeam[] | null }) {
  return (
    <Field label="Seam testati, secondo lo sviluppatore">
      <div data-testid="candidate-tested-seams">
        {seams === null ? (
          <p className="text-ui-sm text-muted-foreground">Lo sviluppatore non ha riportato i seam testati.</p>
        ) : seams.length === 0 ? (
          <p className="text-ui-sm text-muted-foreground">La spec non ha seam confermati.</p>
        ) : (
          <ul className="space-y-0.5 text-ui-sm">
            {seams.map((s) => (
              <li key={`${s.seam}-${s.tests}`} data-testid="candidate-tested-seam" data-tested={s.tests ? "yes" : "no"} data-agreed={s.agreed ? "yes" : "no"}>
                {s.seam}
                <span className="text-muted-foreground">
                  <Sep />
                  {s.tests ? `test: ${s.tests}` : "nessun test riportato"}
                  {s.agreed ? null : ", fuori dai seam confermati"}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-1 text-ui-xs text-muted-foreground">È una dichiarazione dello sviluppatore, non un'evidenza: contano le verifiche eseguite da Trama.</p>
      </div>
    </Field>
  );
}

export function CandidateCard({ candidateId }: { candidateId: string }) {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  // The inspector already showing this candidate has the diff right below: the button would do nothing (W12).
  const diffOnScreen = useUi((s) => s.inspector?.kind === "candidate" && s.inspector.id === candidateId);
  const candidate = project.document.candidates.find((c) => c.id === candidateId);
  const report = project.candidateReports[candidateId];
  const [preview, setPreview] = useState<ActionResult<"candidate:previewPullRequest"> | null>(null);
  if (!candidate || !report) return null;
  const state = CANDIDATE_STATE[report.state];
  const specialist = project.document.team.specialists.find((s) => s.id === candidate.specialistId);
  const approved = candidate.humanApproval && !report.approvalInvalidated;
  return (
    <CardFrame icon={<IconFileDiff stroke={1.8} />} title={`Candidato ${candidate.id}`} aside={<Badge tone={state.tone}>{state.label}</Badge>}>
      <p className="text-ui-sm text-muted-foreground">
        {specialist ? <AgentName agent={specialist} /> : candidate.specialistId}<Sep />incarico {candidate.assignmentId}<Sep />{candidate.changedFiles.length === 1 ? "1 file" : `${candidate.changedFiles.length} file`}
      </p>
      <Field label="Decisioni pertinenti">
        {candidate.requiredDecisionIds.map((id) => (
          <button key={id} type="button" className="mr-2 font-mono text-[11.5px] text-[var(--color-text-accent)] hover:underline" onClick={() => setInspector({ kind: "decision", id })}>
            {id} v{candidate.decisionVersions[id]}
          </button>
        ))}
      </Field>
      {candidate.testedSeams !== undefined ? <TestedSeamsField seams={candidate.testedSeams} /> : null}
      <Field label="Evidenze delle verifiche">
        <div className="space-y-0.5">
          {candidate.requiredChecks.map((check) => (
            <EvidenceRow key={check} check={check} evidence={candidate.evidence[check] ?? null} />
          ))}
        </div>
      </Field>
      {candidate.technicalReview ? (
        <Field label={`Revisione tecnica, ${candidate.technicalReview.verdict === "approved" ? "approvata" : "modifiche richieste"}`}>
          {candidate.technicalReview.summary}
        </Field>
      ) : null}
      {report.blockers.length ? (
        <Field label="Cosa manca">
          <ul className="space-y-0.5 text-ui-sm">
            {report.blockers.map((b) => (
              <li key={`${b.code}-${b.detail}`}>
                {BLOCKER_TEXT[b.code] ?? b.code}
                {b.code === "BASE_CHANGED" ? null : <span className="text-muted-foreground"><Sep />{b.detail}</span>}
              </li>
            ))}
          </ul>
        </Field>
      ) : null}
      {(() => {
        const conflicts = (project.document.conflicts ?? []).filter((a) => a.candidateId === candidate.id && a.classification !== "clean");
        return conflicts.length ? (
          <Field label="Lavoro dei colleghi">
            {conflicts.map((a) => (
              <div key={a.id} className="text-ui-sm">
                {CONFLICT_LABEL[a.classification].label} con {a.references.join(", ")}
              </div>
            ))}
          </Field>
        ) : null;
      })()}
      {candidate.pullRequest?.mergedAt ? null : <CandidateOverlaps candidateId={candidate.id} />}
      {candidate.clearance ? (
        <p className="mt-2 text-ui-sm text-muted-foreground">
          {report.clearanceInvalidated ? "Il via libera del Coordinatore non vale più: sono cambiate evidenze o decisioni." : "Via libera del Coordinatore."}
        </p>
      ) : null}
      {candidate.pullRequest ? (
        <button
          type="button"
          className="mt-2 inline-flex items-center gap-1 text-ui-sm text-[var(--color-text-accent)] hover:underline"
          onClick={() => void act("shell:openExternal", { url: candidate.pullRequest!.url })}
        >
          <IconGitPullRequest className="size-3.5" /> Pull request #{candidate.pullRequest.number}
        </button>
      ) : null}
      <div className="cta-row mt-3">
        {diffOnScreen ? null : (
          <Button size="sm" variant="outline" onClick={() => setInspector({ kind: "candidate", id: candidate.id })}>
            Apri il diff
          </Button>
        )}
        {report.blockers.length === 0 && !approved ? (
          <Button size="sm" variant="outline" onClick={() => void act("candidate:approve", { candidateId })}>
            Approva questo candidato
          </Button>
        ) : null}
        {approved && !candidate.pullRequest && project.github.repository && !preview ? (
          <Button size="sm" onClick={() => void act("candidate:previewPullRequest", { candidateId }).then((p) => setPreview(p ?? null))}>
            <IconGitPullRequest /> Prepara la pull request
          </Button>
        ) : null}
      </div>
      {preview && !candidate.pullRequest ? (
        <div className="mt-2 space-y-1.5 rounded-lg border border-[color:var(--color-border)] p-2.5 text-ui-sm">
          <p className="text-muted-foreground">
            {preview.repository}<Sep /><span className="font-mono">{preview.head}</span> → <span className="font-mono">{preview.base}</span>
          </p>
          <p className="font-medium text-foreground">{preview.title}</p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-sans text-ui-xs text-foreground/85">{preview.body}</pre>
          <div className="cta-row">
            <Button size="sm" onClick={() => void act("candidate:publish", { candidateId }).then(() => setPreview(null))}>
              <IconGitPullRequest /> Pubblica
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
              Annulla
            </Button>
          </div>
        </div>
      ) : null}
    </CardFrame>
  );
}

export function PlanCard({ planId }: { planId: string }) {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const plan = project.document.plans.find((p) => p.id === planId);
  const [editing, setEditing] = useState<{ steps: string; behavior: string; example: string } | null>(null);
  if (!plan) return null;
  const proposal = plan.proposal;
  const moduleName = (id: string) => project.snapshot.modules.find((m) => m.id === id)?.name ?? id;
  const pendingQuestions = project.document.decisionRequests.filter((r) => plan.decisionRequestIds.includes(r.id) && isOpenQuestion(r)).length;
  return (
    <CardFrame
      icon={<IconListCheck stroke={1.8} />}
      title={`Piano ${plan.id}`}
      aside={
        plan.status === "planning" ? (
          <span className="flex items-center gap-1.5 text-ui-sm text-muted-foreground">
            <Spinner /> {plan.spec?.seamsAnswer ? "Scrittura della spec" : "In preparazione"}
            <button type="button" className="hover:text-foreground" onClick={() => void act("plan:cancel", { planId: plan.id })}>
              Annulla
            </button>
          </span>
        ) : plan.status === "seams" ? (
          <Badge tone="warning">Seam da rivedere</Badge>
        ) : plan.status === "ready" && plan.slicing?.status === "drafting" ? (
          <span className="flex items-center gap-1.5 text-ui-sm text-muted-foreground">
            <Spinner /> Divisione in fette
          </span>
        ) : plan.status === "ready" && plan.slicing?.status === "proposed" ? (
          <Badge tone="warning">Fette da rivedere</Badge>
        ) : plan.status === "ready" && plan.slicing?.status === "approved" ? (
          <Badge tone="success">Fette confermate</Badge>
        ) : plan.status === "stale" ? (
          <Badge tone="warning">Da rivalutare</Badge>
        ) : plan.status === "failed" ? (
          <Badge tone="destructive">Non riuscito</Badge>
        ) : (
          <Badge tone="info">Da rivedere</Badge>
        )
      }
    >
      <p className="text-ui-sm text-muted-foreground">
        {plan.orderedBy === "coordinator" ? "Chiesto dal Coordinatore" : "Chiesto da te"}<Sep />{plan.summary}
      </p>
      {plan.failure ? <Field label="Errore">{plan.failure}</Field> : null}
      {plan.spec ? <PlanSpecBody plan={plan} /> : null}
      {proposal ? (
        <>
          <Field label="Sintesi">{proposal.summary}</Field>
          {plan.editedAt ? <p className="text-ui-xs text-muted-foreground">Corretto da te</p> : null}
          {editing ? (
            <div className="mt-2 space-y-2">
              <label className="block text-ui-xs text-muted-foreground">
                Passi, uno per riga
                <TextArea value={editing.steps} onChange={(e) => setEditing({ ...editing, steps: e.target.value })} className="mt-1 min-h-20" />
              </label>
              <label className="block text-ui-xs text-muted-foreground">
                Comportamento proposto
                <TextArea value={editing.behavior} onChange={(e) => setEditing({ ...editing, behavior: e.target.value })} className="mt-1 min-h-12" />
              </label>
              <label className="block text-ui-xs text-muted-foreground">
                Esempio accettato
                <TextArea value={editing.example} onChange={(e) => setEditing({ ...editing, example: e.target.value })} className="mt-1 min-h-12" />
              </label>
              <div className="cta-row">
                <Button
                  size="sm"
                  onClick={() =>
                    void act("plan:edit", {
                      planId: plan.id,
                      steps: editing.steps.split("\n"),
                      proposedBehavior: editing.behavior,
                      acceptedExample: editing.example,
                    }).then(() => setEditing(null))
                  }
                >
                  Salva il piano
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                  Annulla
                </Button>
              </div>
            </div>
          ) : null}
          <Field label="Passi">
            <ol className="list-decimal space-y-0.5 pl-4">
              {proposal.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </Field>
          <Field label="Comportamento proposto">{proposal.proposedBehavior}</Field>
          <Field label="Esempio accettato">{proposal.acceptedExample}</Field>
          {proposal.affectedModuleIDs.length ? <Field label="Moduli">{proposal.affectedModuleIDs.map(moduleName).join(", ")}</Field> : null}
          {proposal.requiredDecisionIDs.length ? <Field label="Decisioni da rispettare">{proposal.requiredDecisionIDs.join(", ")}</Field> : null}
          {proposal.references.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {proposal.references.slice(0, 10).map((path) => (
                <button
                  key={path}
                  type="button"
                  onClick={() => setInspector({ kind: "file", path })}
                  className="rounded-md bg-[var(--color-background-button-secondary)] px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:text-foreground"
                >
                  {path}
                </button>
              ))}
            </div>
          ) : null}
          {pendingQuestions ? <p className="mt-2 text-ui-sm text-[var(--color-text-accent)]">{pendingQuestions === 1 ? "Una domanda aspetta" : `${pendingQuestions} domande aspettano`} la tua risposta.</p> : null}
          <div className="cta-row mt-3">
            {!editing && plan.status !== "planning" ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  setEditing({ steps: proposal.steps.join("\n"), behavior: proposal.proposedBehavior, example: proposal.acceptedExample })
                }
              >
                Correggi il piano
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              disabled={pendingQuestions > 0 || plan.status === "stale"}
              onClick={() =>
                void act("coordinator:send", {
                  text: `Ho rivisto il piano ${plan.id} e va bene. Realizzalo con il team entro il mandato.`,
                  moduleId: null,
                  model: null,
                  effort: null,
                  // The approval belongs to the dialog of the plan, not always to the project's (W12).
                  goalId: project.document.requests.find((r) => r.id === plan.requestId)?.goalId ?? null,
                })
              }
            >
              Approva il piano e chiedi di realizzarlo
            </Button>
          </div>
        </>
      ) : null}
    </CardFrame>
  );
}

const CONFLICT_LABEL = {
  conflict: { label: "Conflitto", tone: "destructive" as const },
  overlap: { label: "Stessi file", tone: "warning" as const },
  clean: { label: "Nessun conflitto", tone: "success" as const },
  unknown: { label: "Non verificato", tone: "secondary" as const },
};

export function ConflictCard({ assessmentId }: { assessmentId: string }) {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const assessment = project.document.conflicts?.find((a) => a.id === assessmentId);
  if (!assessment) return null;
  const label = CONFLICT_LABEL[assessment.classification];
  const exercise = isExerciseAssessment(assessment);
  // A comparison made on an older snapshot of the candidate, or against a head that moved on, is obsolete (T13).
  const candidate = project.document.candidates.find((c) => c.id === assessment.candidateId);
  const heads =
    project.github.snapshot && !exercise
      ? new Set([...project.github.snapshot.branches.map((b) => b.sha.toLowerCase()), ...project.github.snapshot.pullRequests.map((p) => p.headSHA.toLowerCase())])
      : null;
  const obsolete = (candidate && candidate.snapshotId !== assessment.snapshotId) || (heads !== null && !heads.has(assessment.remoteSHA.toLowerCase()));
  return (
    <CardFrame
      icon={<IconGitBranch stroke={1.8} />}
      title={exercise ? "Esercizio di conflitto" : "Lavoro dei colleghi"}
      aside={
        <>
          {exercise ? <Badge tone="info">Esercizio</Badge> : null}
          {obsolete ? <Badge tone="secondary">Obsoleto</Badge> : <Badge tone={label.tone}>{label.label}</Badge>}
        </>
      }
    >
      {obsolete ? (
        <p className="mb-1 text-ui-xs text-muted-foreground">Il candidato o il lavoro del collega sono cambiati dopo questo confronto: Trama ne farà uno nuovo.</p>
      ) : null}
      {exercise ? (
        <p className="mb-1 text-ui-sm text-muted-foreground">Modifica simulata da Trama in una copia locale separata: non è il lavoro di un collaboratore reale.</p>
      ) : null}
      <p className="text-ui text-foreground/90">
        Candidato{" "}
        <button type="button" className="font-mono text-[11.5px] text-[var(--color-text-accent)] hover:underline" onClick={() => setInspector({ kind: "candidate", id: assessment.candidateId })}>
          {assessment.candidateId}
        </button>{" "}
        e {assessment.references.join(", ")} ({assessment.remoteSHA.slice(0, 7)}).
      </p>
      <p className="mt-1 text-ui-sm text-muted-foreground">{assessment.detail}</p>
      {assessment.conflictingFiles.length ? (
        <Field label={assessment.classification === "conflict" ? "File in conflitto" : "File cambiati da entrambi"}>
          <div className="flex flex-wrap gap-1">
            {assessment.conflictingFiles.map((file) => (
              <span key={file} className="rounded-md bg-[var(--color-background-button-secondary)] px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                {file}
                {assessment.conflictingLines?.[file]?.length ? <span className="font-sans">, {linesLabel(assessment.conflictingLines[file]!)}</span> : null}
              </span>
            ))}
          </div>
        </Field>
      ) : null}
    </CardFrame>
  );
}

/**
 * Decision 6: Trama asks, in the chat, whether to share the presence in this project, with the reason and "Non ora"
 * and "Condividi" on the right. The second proposal comes once, after a conflict the presence would have shown.
 */
export function PresenceConsentCard({ proposal, detail }: { proposal: string; detail: string | null }) {
  const consent = useUi((s) => s.app?.project?.document.presence ?? null);
  const pending = consent?.pending === proposal;
  const answer = proposal === "initial" || proposal === "conflict" ? consent?.answers[proposal] : undefined;
  return (
    <CardFrame
      icon={<IconUsersGroup stroke={1.8} />}
      title="Condividere la presenza?"
      anchor="presence-consent"
      className={cn(!pending && "opacity-80")}
      aside={answer ? <Badge tone={answer === "shared" ? "success" : "secondary"}>{answer === "shared" ? "Condivisa" : "Non ora"}</Badge> : null}
    >
      <div data-testid="presence-consent" data-proposal={proposal} className="space-y-1.5 text-ui text-foreground/90">
        {detail ? <p>{detail}</p> : <p>In questo progetto lavorano anche altre persone.</p>}
        <p>
          Se condividi la presenza, chi collabora con te vede su quale branch lavori tu e i tuoi agenti, i percorsi dei file che toccate e la
          richiesta in corso. Così vi accorgete prima di un lavoro doppio o di un conflitto e il progetto resta coerente.
        </p>
        <p className="text-ui-sm text-muted-foreground">
          Trama non condivide mai il contenuto dei file. Puoi mettere in pausa o smettere quando vuoi, da Impostazioni o da Gruppo.
        </p>
      </div>
      {pending ? (
        <div className="cta-row mt-3">
          <Button size="sm" variant="outline" onClick={() => void act("presence:consent", { share: false, proposal: proposal as "initial" | "conflict" })}>
            Non ora
          </Button>
          <Button size="sm" onClick={() => void act("presence:consent", { share: true, proposal: proposal as "initial" | "conflict" })}>
            Condividi
          </Button>
        </div>
      ) : null}
    </CardFrame>
  );
}

/**
 * G03, before publishing or merging (decision 4): the candidate's files against the colleagues' presence, with the
 * conflicts the merge probes found. A warning, never a lock: the buttons stay where they are.
 */
function CandidateOverlaps({ candidateId }: { candidateId: string }) {
  const project = useUi((s) => s.app?.project)!;
  const overlaps = project.overlaps;
  const candidate = project.document.candidates.find((c) => c.id === candidateId);
  if (!overlaps || !candidate || !project.presence) return null;
  const specialist = project.document.team.specialists.find((s) => s.id === candidate.specialistId);
  const items = compareSides({
    sides: [{ mine: specialist?.name ?? candidate.specialistId, files: candidate.changedFiles, moduleIds: [] }],
    others: project.presence.others,
    modules: project.snapshot.modules.map((m) => ({ id: m.id, name: m.name, relativePath: m.relativePath, files: m.files.map((f) => f.relativePath) })),
    probes: overlaps.probes,
    pullRequests: project.github.snapshot?.pullRequests ?? [],
  });
  if (!items.length) return null;
  return (
    <Field label={candidate.pullRequest ? "Prima di unire, i colleghi" : "Prima di pubblicare, i colleghi"}>
      <div data-testid="candidate-overlaps" className="divide-y divide-[color:var(--app-surface-divider)]">
        {items.map((item) => (
          <OverlapRow key={item.id} item={item} />
        ))}
      </div>
    </Field>
  );
}

/** The live overlap behind a Coordinator's card, when it still holds. */
function findOverlap(project: { overlaps?: { items: OverlapItem[]; tasks: Record<string, OverlapItem[]> } | null }, id: string): OverlapItem | null {
  const overlaps = project.overlaps;
  if (!overlaps) return null;
  return overlaps.items.find((i) => i.id === id) ?? Object.values(overlaps.tasks).flat().find((i) => i.id === id) ?? null;
}

/**
 * Decision 9: the Coordinator points out an overlap in the chat, with the message to the colleague ready. The text
 * is the one said at the time; the files, the lines and the message follow the presence as it is now.
 */
export function OverlapCard({ overlapId, title, detail }: { overlapId: string; title: string; detail: string | null }) {
  const project = useUi((s) => s.app?.project)!;
  const item = findOverlap(project, overlapId);
  return (
    <CardFrame
      icon={<IconUsers stroke={1.8} />}
      title={title}
      anchor="presence-overlap"
      aside={item ? null : <Badge tone="secondary">Non più attuale</Badge>}
    >
      <div data-testid="overlap-card" data-level={item?.level ?? "gone"}>
        {detail ? <p className="text-ui text-foreground/90">{detail}</p> : null}
        {item ? <OverlapRow item={item} /> : <p className="mt-1 text-ui-xs text-muted-foreground">La presenza dei colleghi è cambiata dopo questo avviso.</p>}
      </div>
    </CardFrame>
  );
}
