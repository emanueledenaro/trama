import { RecordLabel } from "@/components/chat/ReferenceText";
import { IconArrowLeft, IconPencil, IconPlus, IconRosetteDiscountCheck, IconTarget } from "@tabler/icons-react";
import { useState } from "react";
import { assignmentStatus, checkOutcome } from "@shared/states";
import { isOpenQuestion } from "@shared/domain";
import { decisionDependents } from "@shared/goals";
import { DecisionCard } from "@/components/chat/Cards";
import { Button } from "@/components/ui/button";
import { Badge, Input, Label, TextArea } from "@/components/ui/field";
import { formatDate } from "@/lib/format";
import { act, useUi } from "@/lib/store";
import { EmptyNote, InspectorSection } from "./Inspector";
import { Sep } from "@/components/ui/sep";
import { WaitingProposalPointer } from "@/components/WaitingPointer";
import { AgentName } from "@/components/AgentIdentity";
import { Tooltip } from "@/components/ui/tooltip";
import { useT } from "@/lib/i18n";

function DecisionEditor({ initial, onDone }: { initial?: { id: string; value: string; acceptedExample: string; rationale: string }; onDone: () => void }) {
  const [value, setValue] = useState(initial?.value ?? "");
  const [example, setExample] = useState(initial?.acceptedExample ?? "");
  const [rationale, setRationale] = useState(initial?.rationale ?? "");
  const valid = value.trim() && example.trim() && rationale.trim();
  return (
    <div className="space-y-2.5 rounded-xl border border-[color:var(--color-border)] p-3">
      <div>
        <Label>Comportamento</Label>
        <TextArea value={value} onChange={(e) => setValue(e.target.value)} placeholder="Cosa deve succedere" />
      </div>
      <div>
        <Label>Esempio accettato</Label>
        <Input value={example} onChange={(e) => setExample(e.target.value)} placeholder="Un caso concreto" />
      </div>
      <div>
        <Label>Motivazione</Label>
        <Input value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder="Perché" />
      </div>
      <div className="cta-row">
        <Button
          size="sm"
          disabled={!valid}
          onClick={async () => {
            await act("pact:decide", { id: initial?.id ?? null, value, acceptedExample: example, rationale });
            onDone();
          }}
        >
          Registra decisione
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Annulla
        </Button>
      </div>
    </div>
  );
}

/**
 * Patto in Regole (issue #334): the decisions in force, each with its version small on the right, and Nuova decisione
 * as an icon. A question that waits for the person is one line to Aspetta te, never its card twice.
 */
export function PactView() {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const [editing, setEditing] = useState(false);
  const { decisions, decisionRequests } = project.document;
  const pending = decisionRequests.filter(isOpenQuestion);
  return (
    <>
      {project.isDemo ? <PactDemoBox /> : null}
      {pending.length ? (
        <InspectorSection title={t("rules.pact.pending")}>
          {/* Answered only in Aspetta te (issue #331): one line per question opens it there. */}
          <div className="space-y-1.5">
            {pending.map((request) => (
              <WaitingProposalPointer key={request.id} kind="question" targetId={request.id} textKey="waiting.pointer.question">
                <DecisionCard requestId={request.id} />
              </WaitingProposalPointer>
            ))}
          </div>
        </InspectorSection>
      ) : null}
      <InspectorSection
        title={`${t("rules.pact.inForce")} (${decisions.length})`}
        aside={
          !editing ? (
            <Tooltip label={t("rules.pact.new")}>
              <button type="button" aria-label={t("rules.pact.new")} className="sidebar-icon-button size-6 rounded-md" onClick={() => setEditing(true)}>
                <IconPlus className="size-3.5" stroke={1.8} />
              </button>
            </Tooltip>
          ) : null
        }
      >
        <p className="mb-2 text-ui-xs text-muted-foreground">{t("rules.pact.lead")}</p>
        {editing ? <DecisionEditor onDone={() => setEditing(false)} /> : null}
        {decisions.length === 0 && !editing ? <EmptyNote>{t("rules.pact.none")}</EmptyNote> : null}
        <div className="-mx-2 mt-1 flex flex-col gap-0.5" data-testid="pact-decisions">
          {[...decisions].reverse().map((decision) => (
            <button
              key={decision.id}
              type="button"
              title={decision.value}
              data-record-id={decision.id}
              onClick={() => setInspector({ kind: "decision", id: decision.id })}
              className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-ui text-foreground/90 transition-colors hover:bg-[var(--sidebar-accent)]"
            >
              <IconRosetteDiscountCheck className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
              <span className="min-w-0 flex-1 truncate">{decision.value}</span>
              <span className="shrink-0 text-ui-xs tabular-nums text-muted-foreground/70">{t("rules.pact.version", { version: decision.version })}</span>
            </button>
          ))}
        </div>
      </InspectorSection>
    </>
  );
}

const DEMO_BLOCKERS: Record<string, string> = {
  HUMAN_APPROVAL_REQUIRED: "Serve una revisione umana di questa versione.",
  DECISION_CHANGED: "Una decisione è cambiata. Lo scenario precedente è da riallineare.",
  EVIDENCE_STALE: "Le verifiche si riferiscono a una versione precedente.",
  CHECK_NOT_RUN: "La decisione modificata richiede un nuovo scenario eseguibile.",
};

function PactDemoBox() {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const demo = project.document.pactDemo;
  const blockers = project.pactDemoBlockers;
  const verifiable = blockers.every((b) => b.code === "HUMAN_APPROVAL_REQUIRED");
  return (
    <InspectorSection title="Prova il ciclo di revisione">
      <p className="text-ui-sm text-muted-foreground">
        Simulazione locale: un ordine pagato entra in revisione, mentre pagamento e disponibilità restano invariati. I controlli qui sotto riguardano il
        modello dimostrativo, non il codice del tuo progetto.
      </p>
      <div className="cta-row mt-2">
        <Button size="sm" variant="outline" onClick={() => void act("pactDemo:run", undefined)}>
          Esegui lo scenario
        </Button>
        {demo ? (
          <Button size="sm" variant="outline" disabled={!verifiable || blockers.length === 0} onClick={() => void act("pactDemo:approve", undefined)}>
            Registra revisione locale
          </Button>
        ) : null}
      </div>
      {demo ? (
        <div className="mt-2 space-y-1">
          <Badge tone={blockers.length === 0 ? "success" : "warning"}>{blockers.length === 0 ? "Simulazione verificata e revisionata" : "Revisione da completare"}</Badge>
          {demo.evidence.map((e) => (
            <p key={e.check} className="text-ui-xs text-muted-foreground">
              {checkOutcome(t, e.check, e.result === "pass" || e.result === "fail" ? e.result : null)}<Sep />{e.output}
            </p>
          ))}
          {blockers.map((b) => (
            <p key={`${b.code}-${b.detail}`} className="text-ui-xs text-muted-foreground">
              {DEMO_BLOCKERS[b.code] ?? `${b.code}: ${b.detail}`}
            </p>
          ))}
        </div>
      ) : null}
    </InspectorSection>
  );
}

/** The work that relies on a decision (UX04): what a change would suspend, and the goals it serves. */
function DecisionDependentsSection({ id }: { id: string }) {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const openDialog = useUi((s) => s.openDialog);
  const dependents = decisionDependents(project.document, id);
  const none = !dependents.assignments.length && !dependents.candidates.length && !dependents.goals.length;
  const row = "-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 py-1 text-left text-ui hover:bg-[var(--sidebar-accent)]";
  return (
    <InspectorSection title="Lavori dipendenti">
      {dependents.revisions.length ? (
        <p className="mb-1.5 text-ui-sm text-warning">
          In revisione: {dependents.revisions.map((r) => r.question).join("; ")}. Il lavoro attivo che dipende da questa decisione resta fermo fino alla risposta.
        </p>
      ) : null}
      {none ? (
        <EmptyNote>
          Nessun incarico, candidato o obiettivo dichiara di dipendere da questa decisione. Un lavoro che non la dichiara non viene sospeso quando cambia.
        </EmptyNote>
      ) : null}
      {dependents.assignments.map(({ assignment, specialist, version, current }) => (
        <button key={assignment.id} type="button" className={row} onClick={() => setInspector({ kind: "specialist", id: specialist.id })}>
          <span className="min-w-0 flex-1 truncate">
            <AgentName agent={specialist} />
            <Sep />
            <span title={assignment.id}>{assignment.objective}</span>
          </span>
          <Badge tone={current ? "secondary" : "warning"}>{current ? `v${version}` : `delegato su v${version}`}</Badge>
          <Badge tone={assignmentStatus(t, assignment.status).tone}>{assignmentStatus(t, assignment.status).label}</Badge>
        </button>
      ))}
      {dependents.candidates.map(({ candidate, version, current }) => (
        <button key={candidate.id} type="button" className={row} onClick={() => setInspector({ kind: "candidate", id: candidate.id })}>
          <span className="min-w-0 flex-1 truncate">
            <RecordLabel id={candidate.id} />
            <Sep />
            {candidate.changedFiles.length} file
          </span>
          <Badge tone={current ? "secondary" : "warning"}>{current ? `v${version}` : `evidenze su v${version}: da riverificare`}</Badge>
        </button>
      ))}
      {dependents.goals.map((goal) => (
        <button
          key={goal.id}
          type="button"
          className={row}
          onClick={() => {
            openDialog(goal.id);
            setInspector({ kind: "goal", id: goal.id });
          }}
        >
          <IconTarget className="size-3.5 shrink-0 text-muted-foreground" stroke={1.8} />
          <span className="min-w-0 flex-1 truncate">{goal.title}</span>
          <Badge>obiettivo</Badge>
        </button>
      ))}
    </InspectorSection>
  );
}

export function DecisionView({ id }: { id: string }) {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const [editing, setEditing] = useState(false);
  const decision = project.document.decisions.find((d) => d.id === id);
  const history = project.document.decisionHistory.filter((d) => d.id === id).reverse();
  if (!decision) return <div className="p-4"><EmptyNote>Decisione non trovata.</EmptyNote></div>;
  return (
    <>
      <div className="px-4 pt-3">
        <button type="button" className="inline-flex items-center gap-1 text-ui-sm text-muted-foreground hover:text-foreground" onClick={() => setInspector({ kind: "pact" })}>
          <IconArrowLeft className="size-3.5" /> {t("rules.pact.back")}
        </button>
        <div className="mt-2 flex items-center gap-2">
          <Badge>
            <span title={decision.id}>Versione {decision.version}</span>
          </Badge>
        </div>
      </div>
      <InspectorSection
        title="Comportamento"
        aside={
          !editing ? (
            <Tooltip label={t("rules.pact.edit")}>
              <button type="button" aria-label={t("rules.pact.edit")} className="sidebar-icon-button size-6 rounded-md" onClick={() => setEditing(true)}>
                <IconPencil className="size-3.5" stroke={1.8} />
              </button>
            </Tooltip>
          ) : null
        }
      >
        {editing ? (
          <DecisionEditor initial={decision} onDone={() => setEditing(false)} />
        ) : (
          <>
            <p className="text-ui text-foreground/90">{decision.value}</p>
            <p className="mt-2 text-ui-sm text-muted-foreground">Esempio accettato: {decision.acceptedExample}</p>
            <p className="mt-1 text-ui-sm text-muted-foreground">Motivazione: {decision.rationale}</p>
          </>
        )}
      </InspectorSection>
      <DecisionDependentsSection id={decision.id} />
      <InspectorSection title="Versioni">
        <ol className="space-y-2">
          {history.map((version) => (
            <li key={version.version} className="text-ui-sm">
              <span className="text-foreground/90">v{version.version}</span>
              <span className="text-muted-foreground"><Sep />{formatDate(version.decidedAt)}</span>
              <p className="text-muted-foreground">{version.value}</p>
            </li>
          ))}
        </ol>
      </InspectorSection>
    </>
  );
}
