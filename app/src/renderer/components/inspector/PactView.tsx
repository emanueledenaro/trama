import { IconArrowLeft, IconPlus, IconTarget } from "@tabler/icons-react";
import { useState } from "react";
import { isOpenQuestion } from "@shared/domain";
import { decisionDependents } from "@shared/goals";
import { ASSIGNMENT_STATUS, DecisionCard } from "@/components/chat/Cards";
import { Button } from "@/components/ui/button";
import { Badge, Input, Label, TextArea } from "@/components/ui/field";
import { formatDate } from "@/lib/format";
import { act, useUi } from "@/lib/store";
import { EmptyNote, InspectorSection } from "./Inspector";
import { Sep } from "@/components/ui/sep";
import { AgentName } from "@/components/AgentIdentity";

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

export function PactView() {
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const [editing, setEditing] = useState(false);
  const { decisions, decisionRequests } = project.document;
  const pending = decisionRequests.filter(isOpenQuestion);
  return (
    <>
      {project.isDemo ? <PactDemoBox /> : null}
      <InspectorSection title="Il legame tra decisioni, deleghe e verifiche">
        <p className="text-ui-sm text-muted-foreground">
          Ogni decisione registra un comportamento, un esempio e una motivazione. Ogni modifica incrementa la sua versione.
        </p>
      </InspectorSection>
      {pending.length ? (
        <InspectorSection title="Domande in attesa">
          {pending.map((request) => (
            <DecisionCard key={request.id} requestId={request.id} />
          ))}
        </InspectorSection>
      ) : null}
      <InspectorSection
        title={`Decisioni in vigore (${decisions.length})`}
        aside={
          !editing ? (
            <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
              <IconPlus /> Nuova decisione
            </Button>
          ) : null
        }
      >
        {editing ? <DecisionEditor onDone={() => setEditing(false)} /> : null}
        {decisions.length === 0 && !editing ? <EmptyNote>Nessuna decisione registrata.</EmptyNote> : null}
        <div className="mt-1 flex flex-col gap-1">
          {[...decisions].reverse().map((decision) => (
            <button
              key={decision.id}
              type="button"
              onClick={() => setInspector({ kind: "decision", id: decision.id })}
              className="rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--sidebar-accent)] -mx-2"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-muted-foreground">{decision.id}</span>
                <Badge>v{decision.version}</Badge>
              </div>
              <div className="mt-0.5 line-clamp-2 text-ui text-foreground/90">{decision.value}</div>
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
              {e.check}: {e.result === "pass" ? "superata" : e.result === "fail" ? "non superata" : "non eseguita"}<Sep />{e.output}
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
            <span className="font-mono text-[11px] text-muted-foreground">{assignment.id}</span> <AgentName agent={specialist} /><Sep />{assignment.objective}
          </span>
          <Badge tone={current ? "secondary" : "warning"}>{current ? `v${version}` : `delegato su v${version}`}</Badge>
          <Badge tone={ASSIGNMENT_STATUS[assignment.status].tone}>{ASSIGNMENT_STATUS[assignment.status].label}</Badge>
        </button>
      ))}
      {dependents.candidates.map(({ candidate, version, current }) => (
        <button key={candidate.id} type="button" className={row} onClick={() => setInspector({ kind: "candidate", id: candidate.id })}>
          <span className="min-w-0 flex-1 truncate">
            <span className="font-mono text-[11px] text-muted-foreground">{candidate.id}</span> candidato<Sep />{candidate.changedFiles.length} file
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
          <IconArrowLeft className="size-3.5" /> Apri il Patto completo
        </button>
        <div className="mt-2 flex items-center gap-2">
          <span className="font-mono text-ui-sm text-foreground">{decision.id}</span>
          <Badge>Versione {decision.version}</Badge>
        </div>
      </div>
      <InspectorSection title="Comportamento" aside={!editing ? <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>Modifica</Button> : null}>
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
