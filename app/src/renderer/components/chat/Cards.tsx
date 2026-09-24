import {
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
} from "@tabler/icons-react";
import type { AssignmentStatus, CandidateState } from "@shared/domain";
import { isExerciseAssessment } from "@shared/onboarding";
import { findGoal } from "@shared/goals";
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
    <div data-anchor={anchor} className={cn("my-3 overflow-hidden rounded-xl border border-[color:var(--color-border)] bg-[var(--card)]", className)}>
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
        <div className="mt-2">
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

  return (
    <CardFrame
      icon={<IconShieldCheck stroke={1.8} />}
      title="Mandato"
      aside={
        resolution ? (
          <Badge tone={resolution.kind === "revoked" ? "secondary" : "success"}>
            {resolution.kind === "granted" ? `Concesso · v${resolution.version}` : resolution.kind === "corrected" ? `Corretto · v${resolution.version}` : "Non concesso"}
          </Badge>
        ) : (
          <Badge tone="info">In attesa</Badge>
        )
      }
    >
      <p className="text-ui text-foreground/90">{request.reason}</p>
      <Field label="Obiettivi">
        <ul className="list-disc pl-4">
          {request.objectives.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ul>
      </Field>
      {request.priorities.length ? <Field label="Priorità">{request.priorities.join(" · ")}</Field> : null}
      <Field label="Perimetro">{request.scopeModuleIds.map(moduleName).join(", ")}</Field>
      <Field label="Azioni autorizzate">{request.authorizedActions.map((a) => ACTION_LABELS[a]).join(" · ")}</Field>
      {request.limits.length ? <Field label="Limiti">{request.limits.join(" · ")}</Field> : null}
      {!resolution ? (
        revoking ? (
          <div className="mt-3 space-y-2">
            <TextArea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo" aria-label="Motivo della revoca" />
            <div className="flex gap-2">
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
          <div className="mt-3 flex flex-wrap gap-2">
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
  const request = project.document.decisionRequests.find((r) => r.id === requestId);
  if (!request) return null;
  const outcome = request.outcome;

  return (
    <CardFrame
      icon={<IconRosetteDiscountCheck stroke={1.8} />}
      title="Decisione"
      aside={<Badge tone={request.category === "destructive" ? "destructive" : "info"}>{request.category === "destructive" ? "Caso distruttivo" : "Scelta di prodotto"}</Badge>}
    >
      <p className="text-ui font-medium text-foreground">{request.question}</p>
      <Field label="Caso concreto">{request.concreteCase}</Field>
      <div className="mt-3 space-y-1.5">
        {request.alternatives.map((alternative, index) => {
          const chosen = outcome ? outcome.alternativeIndex === index : choice === index;
          return (
            <button
              key={alternative.behavior}
              type="button"
              disabled={Boolean(outcome)}
              onClick={() => {
                setChoice(index);
                setFreeText("");
              }}
              className={cn(
                "block w-full rounded-lg border px-3 py-2 text-left transition-colors",
                chosen
                  ? "border-[color:var(--color-text-accent)] bg-[color-mix(in_srgb,var(--color-text-accent)_7%,transparent)]"
                  : "border-[color:var(--color-border)] hover:bg-[var(--color-background-button-secondary-hover)]",
                outcome && !chosen && "opacity-60",
              )}
            >
              <div className="text-ui text-foreground">{alternative.behavior}</div>
              <div className="mt-0.5 text-ui-sm text-muted-foreground">Esempio: {alternative.example}</div>
              {alternative.consequence ? <div className="mt-0.5 text-ui-sm text-muted-foreground">Conseguenza: {alternative.consequence}</div> : null}
            </button>
          );
        })}
      </div>
      {outcome ? (
        <div className="mt-3 flex items-center gap-2 text-ui-sm text-muted-foreground">
          <span>
            Decisione {outcome.decisionId} · versione {outcome.version}
          </span>
          <button type="button" className="text-[var(--color-text-accent)] hover:underline" onClick={() => setInspector({ kind: "decision", id: outcome.decisionId })}>
            Apri nel Patto
          </button>
          {outcome.alternativeIndex === null ? <span className="truncate">· «{outcome.answer}»</span> : null}
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
      )}
    </CardFrame>
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
                  {member.name} <span className="text-muted-foreground">· {member.competence}</span>
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
          <Button
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
        {specialist.name} <span className="text-muted-foreground">· {specialist.competence}</span>
      </Field>
      <Field label="Obiettivo">{assignment.objective}</Field>
      {assignment.exercise ? <Field label="Esercizio">{assignment.exercise}</Field> : null}
      <Field label="Perimetro">{assignment.moduleIds.map(moduleName).join(", ")}</Field>
      {assignment.dependencies.length ? <Field label="Dipendenze">{assignment.dependencies.join(", ")}</Field> : null}
      {goal ? (
        <Field label="Obiettivo del progetto">
          <button type="button" className="text-left text-[var(--color-text-accent)] hover:underline" onClick={() => setInspector({ kind: "goal", id: goal.id })}>
            {goal.title}
          </button>
        </Field>
      ) : null}
      <Field label="Provider e modello scelti all'assegnazione">
        {providerLabel(assignment.provider)} · {assignment.model}
        <div className="mt-0.5 text-ui-sm text-muted-foreground">
          {assignment.modelReason ? `Motivazione del Coordinatore: ${assignment.modelReason}` : "Il Coordinatore non ha registrato una motivazione per questa scelta."}
        </div>
        {lastTurn && (lastTurn.provider ?? "codex") !== (assignment.provider ?? "codex") ? (
          <div className="mt-0.5 text-ui-sm text-warning">Ultimo turno eseguito con {providerLabel(lastTurn.provider)} · {lastTurn.model}</div>
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
        <div className="mt-3 flex gap-2">
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

export function CandidateCard({ candidateId }: { candidateId: string }) {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
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
        {specialist?.name ?? candidate.specialistId} · incarico {candidate.assignmentId} · {candidate.changedFiles.length === 1 ? "1 file" : `${candidate.changedFiles.length} file`}
      </p>
      <Field label="Decisioni pertinenti">
        {candidate.requiredDecisionIds.map((id) => (
          <button key={id} type="button" className="mr-2 font-mono text-[11.5px] text-[var(--color-text-accent)] hover:underline" onClick={() => setInspector({ kind: "decision", id })}>
            {id} v{candidate.decisionVersions[id]}
          </button>
        ))}
      </Field>
      <Field label="Evidenze delle verifiche">
        <div className="space-y-0.5">
          {candidate.requiredChecks.map((check) => {
            const evidence = candidate.evidence[check];
            return (
              <div key={check} className="flex items-center gap-1.5 text-ui-sm">
                {evidence?.result === "pass" ? (
                  <IconCircleCheck className="size-3.5 text-success" />
                ) : evidence?.result === "fail" ? (
                  <IconCircleX className="size-3.5 text-destructive" />
                ) : (
                  <span className="inline-block size-3.5 rounded-full border border-dashed border-muted-foreground/50" />
                )}
                <span className="font-mono text-[11.5px]">{check}</span>
                <span className="text-muted-foreground">{evidence ? (evidence.result === "pass" ? "superata" : "non superata") : "non eseguita"}</span>
              </div>
            );
          })}
        </div>
      </Field>
      {candidate.technicalReview ? (
        <Field label={`Revisione tecnica · ${candidate.technicalReview.verdict === "approved" ? "approvata" : "modifiche richieste"}`}>
          {candidate.technicalReview.summary}
        </Field>
      ) : null}
      {report.blockers.length ? (
        <Field label="Cosa manca">
          <ul className="space-y-0.5 text-ui-sm">
            {report.blockers.map((b) => (
              <li key={`${b.code}-${b.detail}`}>
                {BLOCKER_TEXT[b.code] ?? b.code}
                {b.code === "BASE_CHANGED" ? null : <span className="text-muted-foreground"> · {b.detail}</span>}
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
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setInspector({ kind: "candidate", id: candidate.id })}>
          Apri il diff
        </Button>
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
            {preview.repository} · <span className="font-mono">{preview.head}</span> → <span className="font-mono">{preview.base}</span>
          </p>
          <p className="font-medium text-foreground">{preview.title}</p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-sans text-ui-xs text-foreground/85">{preview.body}</pre>
          <div className="flex gap-2">
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
  const pendingQuestions = project.document.decisionRequests.filter((r) => plan.decisionRequestIds.includes(r.id) && !r.outcome).length;
  return (
    <CardFrame
      icon={<IconListCheck stroke={1.8} />}
      title={`Piano ${plan.id}`}
      aside={
        plan.status === "planning" ? (
          <span className="flex items-center gap-1.5 text-ui-sm text-muted-foreground">
            <Spinner /> In preparazione
            <button type="button" className="hover:text-foreground" onClick={() => void act("plan:cancel", { planId: plan.id })}>
              Annulla
            </button>
          </span>
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
        {plan.orderedBy === "coordinator" ? "Chiesto dal Coordinatore" : "Chiesto da te"} · {plan.summary}
      </p>
      {plan.failure ? <Field label="Errore">{plan.failure}</Field> : null}
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
              <div className="flex gap-2">
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
          <div className="mt-3 flex flex-wrap gap-2">
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
              </span>
            ))}
          </div>
        </Field>
      ) : null}
    </CardFrame>
  );
}
