import { IconBellPause, IconCircleCheck, IconCircleDashed, IconCircleX, IconFocus2 } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import type { AuditAxis, AuditFinding, FocusAudit } from "@shared/domain";
import { evidenceLabel, FINDING_STATUS_TEXT, findingTally, fixedPointText, focusTargetOf } from "@shared/findings";
import { plainText } from "@shared/plainLanguage";
import { EvidenceRow } from "@/components/chat/Cards";
import { ChatMarkdown } from "@/components/chat/ChatMarkdown";
import { AUDIT_STATUS_TEXT, examineAgain, FINDING_TONE, isRunning } from "@/components/inspector/AuditView";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { Sep } from "@/components/ui/sep";
import { cn } from "@/lib/cn";
import { act, useUi } from "@/lib/store";

type StepState = "done" | "running" | "waiting" | "failed" | "skipped";

const AXIS_TITLE = { standards: "Standards", spec: "Spec" } as const;

function StepIcon({ state }: { state: StepState }) {
  if (state === "running") return <Spinner className="size-3.5" />;
  if (state === "done") return <IconCircleCheck className="size-3.5 text-success" stroke={1.8} />;
  if (state === "failed") return <IconCircleX className="size-3.5 text-destructive" stroke={1.8} />;
  return <IconCircleDashed className="size-3.5 text-muted-foreground/60" stroke={1.8} />;
}

function Step({ state, title, children }: { state: StepState; title: string; children?: React.ReactNode }) {
  return (
    <li className="py-2" data-testid="focus-step" data-state={state}>
      <div className="flex items-center gap-2 text-ui text-foreground">
        <StepIcon state={state} />
        <span className="min-w-0 flex-1">{title}</span>
      </div>
      {children ? <div className="mt-1 pl-5.5">{children}</div> : null}
    </li>
  );
}

const axisState = (axis: AuditAxis): StepState =>
  axis.status === "done" ? "done" : axis.status === "running" ? "running" : axis.status === "failed" ? "failed" : axis.status === "skipped" ? "skipped" : "waiting";

function axisNote(axis: AuditAxis): string {
  if (axis.status === "waiting") return "Parte dopo le verifiche reali.";
  if (axis.status === "running") return axis.model ? `In esame con ${axis.model}.` : "In esame.";
  if (axis.status === "skipped") return axis.report ? plainText(axis.report) : "Saltato.";
  if (axis.status === "failed") return axis.failure ?? "L'asse non ha prodotto un rapporto.";
  const n = axis.findings ?? 0;
  return n === 0 ? "Nessun rilievo." : n === 1 ? "1 rilievo." : `${n} rilievi.`;
}

/** Left: how far the examination got, the real checks first (spec #124). */
function Progress({ audit, checks }: { audit: FocusAudit; checks: string[] }) {
  // An examination that failed before the axes started failed in its checks.
  const checksState: StepState = audit.status === "checking" ? "running" : audit.status === "failed" && !audit.standards.startedAt ? "failed" : "done";
  const verifying: StepState = audit.status === "verifying" ? "running" : audit.status === "done" ? "done" : audit.status === "failed" ? "failed" : "waiting";
  return (
    <ol className="divide-y divide-[color:var(--app-surface-divider)]" aria-label="Avanzamento">
      <Step state="done" title="Punto fisso">
        <p className="text-ui-sm text-muted-foreground">
          <span className="font-mono text-[11.5px] text-foreground/85" title={audit.fixedPoint}>{fixedPointText(audit)}</span>
          <Sep />
          {audit.changedFiles.length === 1 ? "1 file cambiato" : `${audit.changedFiles.length} file cambiati`}
          {audit.commits ? <><Sep />{audit.commits.length === 1 ? "1 commit" : `${audit.commits.length} commit`}</> : null}
        </p>
      </Step>
      <Step state={checksState} title="Verifiche reali">
        <div className="space-y-0.5" data-testid="focus-audit-checks">
          {checks.length ? (
            checks.map((check) => <EvidenceRow key={check} check={check} evidence={audit.checks.find((c) => c.check === check) ?? null} />)
          ) : (
            <p className="text-ui-sm text-muted-foreground">Nessuna verifica applicabile a questo progetto.</p>
          )}
        </div>
      </Step>
      {(["standards", "spec"] as const).map((name) => (
        <Step key={name} state={axisState(audit[name])} title={`Asse ${AXIS_TITLE[name]}`}>
          <p className={cn("text-ui-sm", audit[name].status === "failed" ? "text-destructive" : "text-muted-foreground")}>{axisNote(audit[name])}</p>
          {name === "spec" && audit.specSource ? <p className="mt-0.5 text-ui-sm text-muted-foreground">Fonte: {audit.specSource}</p> : null}
        </Step>
      ))}
      <Step state={verifying} title="Verifica delle prove">
        <p className="text-ui-sm text-muted-foreground">Trama ricontrolla ogni prova; un rilievo grave che non può ricontrollare passa a un modello più forte.</p>
      </Step>
    </ol>
  );
}

function FindingButton({ finding, selected, onSelect }: { finding: AuditFinding; selected: boolean; onSelect(): void }) {
  const { evidence } = finding;
  return (
    <li data-testid="audit-finding" data-finding={finding.id} data-status={finding.status} data-severity={finding.severity}>
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
          "w-full space-y-1 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-[var(--sidebar-accent)]",
          selected && "bg-[var(--sidebar-accent)] ring-1 ring-[color:var(--color-border)]",
        )}
      >
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone={FINDING_TONE[finding.status]}>{FINDING_STATUS_TEXT[finding.status]}</Badge>
          {finding.severity === "serious" ? <Badge tone="destructive">Grave</Badge> : null}
          <span className="text-ui text-foreground">{finding.title}</span>
        </span>
        <span className="block text-ui-sm text-muted-foreground" data-testid="audit-finding-evidence">
          Prova: {evidence && evidence.kind !== "reproduction" ? <span className="font-mono text-[11.5px] text-foreground/85">{evidenceLabel(evidence)}</span> : evidenceLabel(evidence)}
        </span>
      </button>
    </li>
  );
}

/** Center: the findings of each axis, kept apart as the skill presents them, then each axis's own report. */
function Findings({ audit, selected, onSelect }: { audit: FocusAudit; selected: string | null; onSelect(id: string): void }) {
  const tally = findingTally(audit);
  return (
    <div className="space-y-4">
      {audit.summary ? (
        <div className="chat-card px-3.5 py-2.5">
          <p className="text-ui text-foreground" data-testid="focus-audit-summary">{plainText(audit.summary)}</p>
          {tally ? <p className="mt-1 text-ui-sm text-muted-foreground" data-testid="focus-audit-tally">Stato dei rilievi: {tally}.</p> : null}
        </div>
      ) : null}
      {audit.status === "failed" && audit.failure ? <p className="text-ui-sm text-destructive">{audit.failure}</p> : null}
      {(["standards", "spec"] as const).map((name) => {
        const axis = audit[name];
        return (
          <section key={name} data-testid="audit-axis" data-axis={name} data-status={axis.status} aria-label={`Asse ${AXIS_TITLE[name]}`}>
            <div className="mb-1.5 flex items-center gap-2">
              <h3 className="min-w-0 flex-1 text-ui-sm font-medium text-muted-foreground">{AXIS_TITLE[name]}</h3>
              {name === "spec" && audit.specSource ? <Badge tone="outline">{audit.specSource}</Badge> : null}
            </div>
            {axis.status === "done" ? (
              <>
                {axis.items?.length ? (
                  <ul className="space-y-0.5" data-testid="audit-findings">
                    {axis.items.map((finding) => (
                      <FindingButton key={finding.id} finding={finding} selected={selected === finding.id} onSelect={() => onSelect(finding.id)} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-ui-sm text-muted-foreground">Nessun rilievo.</p>
                )}
                <details className="mt-2 rounded-lg border border-[color:var(--app-surface-divider)] px-3 py-2">
                  <summary className="cursor-pointer text-ui-sm text-muted-foreground">Rapporto dell'asse {AXIS_TITLE[name]}</summary>
                  <div className="mt-2 text-ui">
                    <ChatMarkdown text={axis.report ?? ""} plain />
                  </div>
                </details>
              </>
            ) : (
              <p className={cn("flex items-center gap-1.5 text-ui-sm", axis.status === "failed" ? "text-destructive" : "text-muted-foreground")}>
                {axis.status === "running" ? <Spinner /> : null}
                {axisNote(axis)}
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

/** Right: the proof of the selected finding and how Trama verified it (F02); a hypothesis stays one. */
function Proof({ finding }: { finding: AuditFinding | null }) {
  if (!finding) return <p className="text-ui text-muted-foreground/70">Scegli un rilievo per vedere la sua prova.</p>;
  const { evidence } = finding;
  return (
    <div className="space-y-3" data-testid="focus-proof" data-finding={finding.id}>
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={FINDING_TONE[finding.status]}>{FINDING_STATUS_TEXT[finding.status]}</Badge>
          {finding.severity === "serious" ? <Badge tone="destructive">Grave</Badge> : null}
        </div>
        <p className="text-ui text-foreground">{finding.title}</p>
      </div>
      <div>
        <h4 className="text-ui-sm font-medium text-muted-foreground">Prova</h4>
        {!evidence ? (
          <p className="mt-1 text-ui-sm text-muted-foreground">L'asse non ha dato una prova.</p>
        ) : evidence.kind === "reproduction" ? (
          <p className="mt-1 whitespace-pre-wrap text-ui-sm text-foreground/85">{evidence.steps}</p>
        ) : (
          <>
            <p className="mt-1 font-mono text-[11.5px] text-foreground/85">{evidenceLabel(evidence)}</p>
            {evidence.kind === "fileLine" && evidence.quote ? (
              <p className="mt-1 text-ui-sm text-muted-foreground">
                Riga citata: <code className="font-mono text-[11.5px] text-foreground/85">{evidence.quote}</code>
              </p>
            ) : null}
          </>
        )}
      </div>
      {finding.basis ? (
        <div>
          <h4 className="text-ui-sm font-medium text-muted-foreground">Come l'ha verificata Trama</h4>
          <p className="mt-1 text-ui-sm text-foreground/85" data-testid="audit-finding-basis">{finding.basis}</p>
        </div>
      ) : null}
      {finding.observed ? (
        <div>
          <h4 className="text-ui-sm font-medium text-muted-foreground">Cosa ha letto Trama</h4>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-[var(--app-chat-code-surface)] px-3 py-2 font-mono text-[11px] leading-[1.55] text-foreground/85">
            {finding.observed}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function Column({ title, testId, className, children }: { title: string; testId: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={cn("flex min-h-0 min-w-0 flex-col", className)} aria-label={title} data-testid={testId}>
      <h2 className="shrink-0 px-4 pt-3 pb-1 text-ui-sm font-medium text-muted-foreground">{title}</h2>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
    </section>
  );
}

/**
 * Full-screen focus mode (F03, spec #124): progress on the left, findings in the middle, the proof on the right. It
 * covers the whole window until the person leaves it; the other projects keep working and their notifications wait.
 */
export function FocusModeView({ isMac }: { isMac: boolean }) {
  const project = useUi((s) => s.app?.project)!;
  const focus = useUi((s) => s.app?.focusMode)!;
  const audit = (project.document.audits ?? []).find((a) => a.id === focus.auditId) ?? null;
  const findings = audit ? [...(audit.standards.items ?? []), ...(audit.spec.items ?? [])] : [];
  const [selected, setSelected] = useState<string | null>(null);
  const shown = findings.find((f) => f.id === selected) ?? findings[0] ?? null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector("[role=dialog]")) void act("focusMode:exit", undefined);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const exit = (
    <Button size="sm" onClick={() => void act("focusMode:exit", undefined)}>
      Esci dall'esame
    </Button>
  );
  if (!audit) {
    return (
      <div className="chat-content-card flex h-svh w-full flex-col items-center justify-center gap-3" data-focus-mode="">
        <p className="text-ui text-muted-foreground">Esame non trovato.</p>
        <div className="cta-row">{exit}</div>
      </div>
    );
  }
  const running = isRunning(audit);
  const target = audit.target;
  const assignment = target.kind === "candidate" ? project.document.team.specialists.flatMap((s) => s.assignments).find((a) => a.id === target.assignmentId) : null;
  const candidate = target.kind === "candidate" ? project.document.candidates.find((c) => c.id === target.candidateId) : null;
  const checks = candidate?.requiredChecks ?? audit.checks.map((c) => c.check);

  return (
    <div className="chat-content-card relative flex h-svh w-full min-w-0 flex-col" data-testid="focus-audit" data-focus-mode="" data-status={audit.status}>
      <header
        className={cn(
          "chat-surface-divider drag-region flex min-h-[46px] shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 sm:px-5",
          isMac && "desktop-top-bar-traffic-light-gutter",
        )}
      >
        <div className="flex min-w-[12rem] flex-1 items-center gap-2">
          <IconFocus2 className="size-4 shrink-0 text-muted-foreground" stroke={1.7} />
          <h1 className="min-w-0 truncate font-system-ui text-ui text-foreground" data-testid="focus-mode-title">
            <span className="font-medium">Esame approfondito</span> <span className="text-muted-foreground">{focusTargetOf(audit.target, assignment?.objective)}</span>
          </h1>
          <span className="flex shrink-0 items-center gap-1.5 text-ui-sm text-muted-foreground" data-testid="focus-audit-status">
            <Sep />
            {running ? <Spinner /> : null}
            {AUDIT_STATUS_TEXT[audit.status]}
          </span>
        </div>
        <div className="no-drag flex flex-wrap items-center justify-end gap-2">
          <span className="inline-flex items-center gap-1 text-ui-sm text-muted-foreground" data-testid="focus-mode-notifications" title="Le notifiche arrivano quando esci dall'esame">
            <IconBellPause className="size-3.5" stroke={1.7} />
            {focus.pausedNotifications ? `Notifiche in pausa: ${focus.pausedNotifications}` : "Notifiche in pausa"}
          </span>
          <div className="cta-row">
            {running ? null : (
              <Button size="sm" variant="outline" onClick={() => void examineAgain(audit)}>
                Esamina di nuovo
              </Button>
            )}
            {exit}
          </div>
        </div>
      </header>
      <div
        className="grid min-h-0 flex-1 grid-cols-[minmax(13rem,15rem)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_minmax(0,auto)] lg:grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)_minmax(18rem,24rem)] lg:grid-rows-1"
        data-testid="focus-columns"
      >
        <Column title="Avanzamento" testId="focus-progress" className="row-span-2 border-r border-[color:var(--app-surface-divider)] lg:row-span-1">
          <Progress audit={audit} checks={checks} />
          <p className="mt-3 text-ui-sm text-muted-foreground">
            Sola lettura: l'esame non cambia il codice. Le verifiche sono fatti; un rilievo è verificato solo quando Trama ha ricontrollato la sua prova.
          </p>
        </Column>
        <Column title="Rilievi" testId="focus-findings">
          <Findings audit={audit} selected={shown?.id ?? null} onSelect={setSelected} />
        </Column>
        <Column
          title="Prova"
          testId="focus-proof-column"
          className="max-h-[45vh] border-t border-[color:var(--app-surface-divider)] lg:max-h-none lg:border-t-0 lg:border-l"
        >
          <Proof finding={shown} />
        </Column>
      </div>
    </div>
  );
}
