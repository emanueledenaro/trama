import { RecordLabel } from "@/components/chat/ReferenceText";
import { IconArrowLeft, IconPencil, IconPlus, IconRosetteDiscountCheck, IconTarget } from "@tabler/icons-react";
import { useState } from "react";
import { assignmentStatus, checkOutcome } from "@shared/states";
import { isOpenQuestion } from "@shared/domain";
import { decisionDependents } from "@shared/goals";
import { DecisionCard } from "@/components/chat/Cards";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Badge, Input, Label, TextArea } from "@/components/ui/field";
import { formatDate } from "@/lib/format";
import { act, useUi } from "@/lib/store";
import { EmptyNote, InspectorSection } from "./Inspector";
import { Sep } from "@/components/ui/sep";
import { WaitingProposalPointer } from "@/components/WaitingPointer";
import { AgentName } from "@/components/AgentIdentity";
import { useT } from "@/lib/i18n";

function DecisionEditor({ initial, onDone }: { initial?: { id: string; value: string; acceptedExample: string; rationale: string }; onDone: () => void }) {
  const t = useT();
  const [value, setValue] = useState(initial?.value ?? "");
  const [example, setExample] = useState(initial?.acceptedExample ?? "");
  const [rationale, setRationale] = useState(initial?.rationale ?? "");
  const valid = value.trim() && example.trim() && rationale.trim();
  return (
    <div className="space-y-4 rounded-xl border border-[color:var(--color-border)] p-4" data-testid="decision-editor">
      <div>
        <Label>{t("rules.pact.field.behavior")}</Label>
        <TextArea value={value} onChange={(e) => setValue(e.target.value)} placeholder={t("rules.pact.field.behaviorHint")} />
      </div>
      <div>
        <Label>{t("rules.pact.field.example")}</Label>
        <Input value={example} onChange={(e) => setExample(e.target.value)} placeholder={t("rules.pact.field.exampleHint")} />
      </div>
      <div>
        <Label>{t("rules.pact.field.rationale")}</Label>
        <Input value={rationale} onChange={(e) => setRationale(e.target.value)} placeholder={t("rules.pact.field.rationaleHint")} />
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
          {t("rules.pact.record")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          {t("rules.change.cancel")}
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
          <div className="space-y-2">
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
          !editing ? <IconButton size="icon" label={t("rules.pact.new")} icon={<IconPlus stroke={1.8} />} onClick={() => setEditing(true)} /> : null
        }
      >
        <p className="mb-2 text-ui-xs text-muted-foreground">{t("rules.pact.lead")}</p>
        {editing ? <DecisionEditor onDone={() => setEditing(false)} /> : null}
        {decisions.length === 0 && !editing ? (
          <div className="space-y-2" data-testid="pact-empty">
            <EmptyNote>{t("rules.pact.none")}</EmptyNote>
            <div className="cta-row">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                {t("rules.pact.firstDecision")}
              </Button>
            </div>
          </div>
        ) : null}
        <div className="-mx-2 mt-1 flex flex-col gap-0.5" data-testid="pact-decisions">
          {[...decisions].reverse().map((decision) => (
            <button
              key={decision.id}
              type="button"
              title={decision.value}
              data-record-id={decision.id}
              onClick={() => setInspector({ kind: "decision", id: decision.id })}
              className="flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-ui text-foreground/90 transition-colors hover:bg-[var(--sidebar-accent)]"
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

const DEMO_BLOCKERS = {
  HUMAN_APPROVAL_REQUIRED: "rules.pact.demo.blocker.HUMAN_APPROVAL_REQUIRED",
  DECISION_CHANGED: "rules.pact.demo.blocker.DECISION_CHANGED",
  EVIDENCE_STALE: "rules.pact.demo.blocker.EVIDENCE_STALE",
  CHECK_NOT_RUN: "rules.pact.demo.blocker.CHECK_NOT_RUN",
} as const;

function PactDemoBox() {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const demo = project.document.pactDemo;
  const blockers = project.pactDemoBlockers;
  const verifiable = blockers.every((b) => b.code === "HUMAN_APPROVAL_REQUIRED");
  return (
    <InspectorSection title={t("rules.pact.demo.title")}>
      <p className="text-ui-sm text-muted-foreground">{t("rules.pact.demo.lead")}</p>
      <div className="cta-row mt-2">
        <Button size="sm" variant="outline" onClick={() => void act("pactDemo:run", undefined)}>
          {t("rules.pact.demo.run")}
        </Button>
        {demo ? (
          <Button size="sm" variant="outline" disabled={!verifiable || blockers.length === 0} onClick={() => void act("pactDemo:approve", undefined)}>
            {t("rules.pact.demo.approve")}
          </Button>
        ) : null}
      </div>
      {demo ? (
        <div className="mt-2 space-y-1">
          <Badge tone={blockers.length === 0 ? "success" : "warning"}>{blockers.length === 0 ? t("rules.pact.demo.done") : t("rules.pact.demo.todo")}</Badge>
          {demo.evidence.map((e) => (
            <p key={e.check} className="text-ui-xs text-muted-foreground">
              {checkOutcome(t, e.check, e.result === "pass" || e.result === "fail" ? e.result : null)}<Sep />{e.output}
            </p>
          ))}
          {blockers.map((b) => (
            <p key={`${b.code}-${b.detail}`} className="text-ui-xs text-muted-foreground">
              {b.code in DEMO_BLOCKERS ? t(DEMO_BLOCKERS[b.code as keyof typeof DEMO_BLOCKERS]) : `${b.code}: ${b.detail}`}
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
  const row = "-mx-2 flex min-h-8 w-[calc(100%+1rem)] items-center gap-2 rounded-lg px-2 py-1 text-left text-ui hover:bg-[var(--sidebar-accent)]";
  return (
    <InspectorSection title={t("rules.pact.dependents.title")}>
      {dependents.revisions.length ? (
        <p className="mb-1.5 text-ui-sm text-warning">
          {t("rules.pact.dependents.revisions", { list: dependents.revisions.map((r) => r.question).join("; ") })}
        </p>
      ) : null}
      {none ? (
        <EmptyNote>{t("rules.pact.dependents.none")}</EmptyNote>
      ) : null}
      {dependents.assignments.map(({ assignment, specialist, version, current }) => (
        <button key={assignment.id} type="button" className={row} onClick={() => setInspector({ kind: "specialist", id: specialist.id })}>
          <span className="min-w-0 flex-1 truncate">
            <AgentName agent={specialist} />
            <Sep />
            <span title={assignment.id}>{assignment.objective}</span>
          </span>
          <Badge tone={current ? "secondary" : "warning"}>{current ? `v${version}` : t("rules.pact.dependents.delegatedOn", { version })}</Badge>
          <Badge tone={assignmentStatus(t, assignment.status).tone}>{assignmentStatus(t, assignment.status).label}</Badge>
        </button>
      ))}
      {dependents.candidates.map(({ candidate, version, current }) => (
        <button key={candidate.id} type="button" className={row} onClick={() => setInspector({ kind: "candidate", id: candidate.id })}>
          <span className="min-w-0 flex-1 truncate">
            <RecordLabel id={candidate.id} />
            <Sep />
            {t("rules.modules.files", { count: candidate.changedFiles.length })}
          </span>
          <Badge tone={current ? "secondary" : "warning"}>{current ? `v${version}` : t("rules.pact.dependents.evidenceOn", { version })}</Badge>
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
          <Badge>{t("rules.pact.dependents.goal")}</Badge>
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
  if (!decision) return <div className="p-4"><EmptyNote>{t("rules.pact.notFound")}</EmptyNote></div>;
  return (
    <>
      <div className="px-4 pt-3">
        <button type="button" className="inline-flex min-h-8 items-center gap-1 text-ui-sm text-muted-foreground hover:text-foreground" onClick={() => setInspector({ kind: "pact" })}>
          <IconArrowLeft className="size-3.5" /> {t("rules.pact.back")}
        </button>
        <div className="mt-2 flex items-center gap-2">
          <Badge>
            <span title={decision.id}>{t("rules.pact.versionLabel", { version: decision.version })}</span>
          </Badge>
        </div>
      </div>
      <InspectorSection
        title={t("rules.pact.field.behavior")}
        aside={!editing ? <IconButton size="icon" label={t("rules.pact.edit")} icon={<IconPencil stroke={1.8} />} onClick={() => setEditing(true)} /> : null}
      >
        {editing ? (
          <DecisionEditor initial={decision} onDone={() => setEditing(false)} />
        ) : (
          <>
            <p className="text-ui text-foreground/90">{decision.value}</p>
            <p className="mt-2 text-ui-sm text-muted-foreground">{t("rules.pact.exampleLine", { value: decision.acceptedExample })}</p>
            <p className="mt-1 text-ui-sm text-muted-foreground">{t("rules.pact.rationaleLine", { value: decision.rationale })}</p>
          </>
        )}
      </InspectorSection>
      <DecisionDependentsSection id={decision.id} />
      <InspectorSection title={t("rules.pact.versions")}>
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
