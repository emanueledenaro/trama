import { IconCheck, IconCircleCheck, IconCircleDashed, IconFileDiff, IconGitPullRequest, IconX } from "@/components/icons";
import { useEffect, useRef } from "react";
import { explainedByDivergence, otherSideSuperseded } from "@shared/conflictScope";
import { candidateGoalId, exampleChecks, findGoal } from "@shared/goals";
import { latestGate } from "@shared/gate";
import { blockerText, plainConflictReference } from "@shared/plainLanguage";
import { squadOf } from "@shared/squads";
import { checkName } from "@shared/states";
import { AgentName } from "@/components/AgentIdentity";
import { EvidenceRow, Field } from "@/components/chat/Cards";
import { GateField } from "@/components/chat/GateField";
import { InterfaceShotsField } from "@/components/chat/InterfaceShots";
import { RecordName, ReferenceText } from "@/components/chat/ReferenceText";
import { Spinner } from "@/components/Spinner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { Sep } from "@/components/ui/sep";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { formatRelativeTime } from "@/lib/format";
import { useT, withNodes } from "@/lib/i18n";
import { asTitle, useRecord } from "@/lib/references";
import { act, useUi } from "@/lib/store";
import { AuditSection } from "./AuditView";
import { CandidateActions } from "./CandidateActions";
import { candidateVerdict, verdictText } from "./candidateVerdict";
import { CandidateOverlaps, CHECK_BLOCKERS, CONFLICT_LABEL, DecisionLink, MergeLine, MergeStopField, QualityField, TechnicalReviewField, TestedSeamsField } from "./CandidateFields";
import { EmptyNote } from "./Inspector";

function lineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff --git") || line.startsWith("index ")) return "text-muted-foreground";
  if (line.startsWith("@@")) return "text-[var(--color-text-accent)]";
  if (line.startsWith("+")) return "bg-success/10 text-foreground";
  if (line.startsWith("-")) return "bg-destructive/10 text-foreground";
  return "text-foreground/80";
}

/** One part of the page: a small title, the part, and a divider under it. Spacing on the 16 px grid. */
function Block({ title, aside, testId, children }: { title: string; aside?: React.ReactNode; testId?: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-[color:var(--app-surface-divider)] px-4 py-4 last:border-b-0" data-testid={testId} aria-label={title}>
      <div className="mb-2 flex min-h-8 items-center gap-2">
        <h3 className="min-w-0 flex-1 text-ui-sm font-medium text-muted-foreground">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * The goal's examples next to the evidence of this exact snapshot (UX06). The person marks what they
 * observed; an observation of another snapshot or of an earlier example text is shown as historical.
 */
function GoalExamplesSection({ candidateId }: { candidateId: string }) {
  const t = useT();
  const project = useUi((s) => s.app?.project)!;
  const setInspector = useUi((s) => s.setInspector);
  const candidate = project.document.candidates.find((c) => c.id === candidateId);
  if (!candidate) return null;
  const goal = findGoal(project.document, candidateGoalId(project.document, candidate));
  if (!goal) {
    return (
      <Block title={t("candidate.examples.none")}>
        <EmptyNote>Questo candidato non è collegato a un obiettivo: non ci sono esempi concordati da confrontare.</EmptyNote>
      </Block>
    );
  }
  const checks = exampleChecks(candidate, goal);
  const passed = Object.values(candidate.evidence).filter((e) => e.result === "pass" && e.snapshotId === candidate.snapshotId).length;
  return (
    <Block title={t("candidate.examples", { version: candidate.snapshotId.slice(0, 12) })}>
      <button type="button" className="mb-2 inline-flex min-h-8 items-center text-left text-ui-sm text-[var(--color-text-accent)] hover:underline" onClick={() => setInspector({ kind: "goal", id: goal.id })}>
        {goal.title}
      </button>
      <p className="mb-2 text-ui-sm text-muted-foreground">
        Verifiche superate su questa versione: {passed} di {candidate.requiredChecks.length}. Le verifiche non provano gli esempi: segna tu cosa hai osservato provando questa
        versione.
      </p>
      {checks.length === 0 ? <EmptyNote>L'obiettivo non ha esempi definiti.</EmptyNote> : null}
      <ul className="space-y-2">
        {checks.map(({ example, current, stale }) => (
          <li key={example.id} className="rounded-lg border border-[color:var(--color-border)] px-2.5 py-2" data-testid="example-check">
            <div className="flex items-start gap-2 text-ui">
              <Badge tone={example.kind === "accepted" ? "success" : "destructive"} className="mt-0.5">
                {example.kind === "accepted" ? "Deve succedere" : "Non deve succedere"}
              </Badge>
              <span className="min-w-0 flex-1 text-foreground/90">{example.text}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-ui-sm">
              {current ? (
                <span className={current.observed ? "text-success" : "text-destructive"}>
                  {current.observed ? "Osservato" : "Non osservato"} su questa versione<Sep />{formatRelativeTime(current.at)}
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Non verificato su questa versione
                  {stale ? `, in precedenza ${stale.observed ? "osservato" : "non osservato"} su un'altra versione o un altro testo` : ""}
                </span>
              )}
              {/* A pair of icons with their tooltips in place of two text buttons per example (issue #336). */}
              <span className="ml-auto flex gap-1">
                <Tooltip label={t("candidate.observedHint")}>
                  <Button
                    size="icon-xs"
                    variant={current?.observed === true ? "outline" : "ghost"}
                    aria-label={t("candidate.observed")}
                    aria-pressed={current?.observed === true}
                    className={cn(current?.observed === true && "text-success")}
                    onClick={() => void act("candidate:observeExample", { candidateId, exampleId: example.id, observed: true, snapshotId: candidate.snapshotId })}
                  >
                    <IconCheck />
                  </Button>
                </Tooltip>
                <Tooltip label={t("candidate.notObservedHint")}>
                  <Button
                    size="icon-xs"
                    variant={current?.observed === false ? "outline" : "ghost"}
                    aria-label={t("candidate.notObserved")}
                    aria-pressed={current?.observed === false}
                    className={cn(current?.observed === false && "text-destructive")}
                    onClick={() => void act("candidate:observeExample", { candidateId, exampleId: example.id, observed: false, snapshotId: candidate.snapshotId })}
                  >
                    <IconX />
                  </Button>
                </Tooltip>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Block>
  );
}

/** A row of the history: what it is, on the left, and its value; 32 px high, with room for a longer value. */
function HistoryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-8 items-start gap-4 py-1 text-ui-sm">
      <span className="w-32 shrink-0 text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1 text-foreground/90">{children}</div>
    </div>
  );
}

/**
 * The candidate's editor tab, wide (issues #336 and #314), from the top: the work in words and who did it; the outcome
 * with what to do and the actions under it; how many files and the diff, closed; the screenshots when the interface
 * changes; the proof (checks, reviewers, the goal's examples, the examination); the history. No state badge repeats
 * the outcome and no box sits inside another.
 */
export function CandidateView({ id, audit, diff }: { id: string; audit?: string; diff?: boolean }) {
  const t = useT();
  const project = useUi((s) => s.app?.project);
  const candidate = project?.document.candidates.find((c) => c.id === id);
  const report = project?.candidateReports[id];
  const record = useRecord(id);
  const auditRef = useRef<HTMLDivElement>(null);
  const diffRef = useRef<HTMLDetailsElement>(null);
  // Opened on an examination or on the diff ("Apri il diff"), the tab opens it and brings it into view.
  useEffect(() => {
    if (audit) auditRef.current?.scrollIntoView({ block: "start" });
  }, [audit]);
  useEffect(() => {
    if (!diff || !diffRef.current) return;
    diffRef.current.open = true;
    diffRef.current.scrollIntoView({ block: "start" });
  }, [diff]);
  if (!candidate || !project) return <div className="p-4"><EmptyNote>{t("candidate.notFound")}</EmptyNote></div>;
  // The report comes from the main process a moment after the candidate: a line says so, never an empty page.
  if (!report) {
    return (
      <p className="flex items-center gap-2 p-4 text-ui text-muted-foreground" data-testid="candidate-loading" aria-busy="true">
        <Spinner /> {t("candidate.loading")}
      </p>
    );
  }
  const specialist = project.document.team.specialists.find((s) => s.id === candidate.specialistId);
  const squad = specialist ? squadOf(project.document, specialist.id) : null;
  const merged = Boolean(candidate.pullRequest?.mergedAt);
  const superseded = report.state === "superseded";
  const verdict = candidateVerdict(t, candidate, report);
  const { outcome, count: missing } = verdict;
  const route = report.mergeRoute ?? "person";
  // As in the card: "open" is a candidate with nothing missing, waiting to be merged.
  const open = outcome === "ready";
  const approved = Boolean(candidate.humanApproval) && !report.approvalInvalidated;
  const quality = report.quality ?? [];
  const stop = candidate.merge?.status === "stopped" ? (candidate.merge.stop ?? null) : null;
  const checks = candidate.requiredChecks.map((check) => ({ check, evidence: candidate.evidence[check] ?? null }));
  const passed = checks.filter((c) => c.evidence?.result === "pass");
  const notPassed = checks.filter((c) => c.evidence?.result !== "pass");
  const gate = latestGate(project.document.gates, candidate.id);
  const conflicts = (project.document.conflicts ?? []).filter(
    (a) => a.candidateId === candidate.id && a.classification !== "clean" && !explainedByDivergence(project.document, a) && !otherSideSuperseded(project.document, a),
  );
  const routeNote = !merged && !superseded && route === "person" ? (report.mergeRouteReason ?? null) : null;
  const OutcomeIcon = outcome === "ready" || outcome === "merged" ? IconCircleCheck : IconCircleDashed;
  return (
    <div data-testid="candidate-detail" data-candidate={candidate.id}>
      <div className="px-4 pt-4 pb-2" data-testid="candidate-header">
        <h2 className="truncate font-system-ui text-ui-lg font-medium text-foreground" title={candidate.id} data-record-id={candidate.id}>
          {record ? asTitle(record.short ?? record.label) : t("chat.card.candidate.title")}
        </h2>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 text-ui-sm text-muted-foreground" data-testid="candidate-author">
          {specialist ? <AgentName agent={specialist} size={24} /> : candidate.specialistId}
          {squad ? (
            <>
              <Sep />
              {t("candidate.squad", { name: squad.name })}
            </>
          ) : null}
        </p>
      </div>
      <section className="px-4 py-4" data-testid="candidate-to-merge" data-outcome={outcome} aria-label={t("candidate.toMerge")}>
        <p className={cn("flex items-center gap-2 text-ui font-medium", outcome === "ready" || outcome === "merged" ? "text-success" : "text-foreground")} data-testid="candidate-outcome">
          <OutcomeIcon className={cn("size-4 shrink-0", outcome === "missing" || outcome === "superseded" ? "text-muted-foreground" : null)} stroke={1.8} />
          <span className="min-w-0">
            <ReferenceText text={verdictText(t, verdict)} />
          </span>
        </p>
        {/* Why Trama cannot merge it alone (no GitHub remote, a mandate that does not cover it) comes first, not after the list. */}
        {routeNote ? (
          <p className="mt-2 text-ui-sm text-muted-foreground" data-testid="candidate-route-note">
            {routeNote}
          </p>
        ) : null}
        {superseded ? (
          <p className="mt-2 text-ui-sm text-muted-foreground" data-testid="candidate-superseded" data-declared={candidate.supersession ? "coordinator" : undefined}>
            {candidate.supersession ? (
              <ReferenceText text={t("supersession.card", { id: candidate.supersession.byCandidateId, reason: candidate.supersession.reason })} />
            ) : (
              t("chat.card.candidate.superseded")
            )}
          </p>
        ) : null}
        {/* The line above says the first condition: the list is for when there are more. */}
        {missing > 1 ? (
          <ul className="mt-2 space-y-1 text-ui-sm" data-testid="candidate-blockers">
            {report.blockers.map((b) => (
              <li key={`${b.code}-${b.detail}`}>
                {blockerText(t, b.code)}
                {b.code === "BASE_CHANGED" || b.code === "WORKTREE_CHANGED" ? null : (
                  <span className="text-muted-foreground">
                    <Sep />
                    <ReferenceText text={CHECK_BLOCKERS.has(b.code) ? checkName(t, b.detail) : b.detail} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        <MergeLine candidate={candidate} route={route} routeReason={routeNote ? null : (report.mergeRouteReason ?? null)} open={open} approved={approved} />
        {stop && open ? <MergeStopField stop={stop} /> : null}
        <div className="mt-4">
          <CandidateActions candidate={candidate} report={report} repository={project.github.repository} publishable={quality.every((i) => i.passed)} />
        </div>
      </section>
      <details ref={diffRef} className="border-y border-[color:var(--app-surface-divider)] px-4" data-testid="candidate-diff">
        <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 py-2 text-ui-sm text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden" title={t("candidate.diff.show")}>
          <span className="min-w-0 flex-1">{t("candidate.diff", { count: candidate.changedFiles.length })}</span>
          <IconFileDiff className="size-4 shrink-0" stroke={1.8} aria-hidden />
        </summary>
        <pre className="mb-4 overflow-x-auto rounded-xl bg-[var(--app-chat-code-surface)] py-2 font-mono text-ui-xs leading-[1.55]">
          {candidate.diff.split("\n").map((line, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: diff lines have no identity beyond their position.
            <div key={index} className={cn("px-4 whitespace-pre", lineClass(line))}>
              {line || " "}
            </div>
          ))}
        </pre>
      </details>
      {route === "interface" && !superseded ? (
        <Block title={t("chat.card.candidate.shots")} testId="candidate-shots">
          <p className="mb-2 break-words text-ui-sm text-muted-foreground" data-testid="candidate-interface-files">
            {(report.interfaceFiles ?? []).map((path, index) => (
              <span key={path}>
                {index ? ", " : null}
                <span className="font-mono text-ui-xs">{path}</span>
              </span>
            ))}
          </p>
          {open ? <InterfaceShotsField candidate={candidate} /> : null}
        </Block>
      ) : null}
      <Block title={t("candidate.proof")} testId="candidate-proof">
        {notPassed.length ? (
          <div className="space-y-1" data-testid="candidate-checks">
            {notPassed.map(({ check, evidence }) => (
              <EvidenceRow key={check} check={check} evidence={evidence} />
            ))}
          </div>
        ) : null}
        {passed.length ? (
          <p className="flex items-start gap-2 text-ui-sm text-muted-foreground" data-testid="candidate-checks-passed">
            <IconCircleCheck className="mt-0.5 size-4 shrink-0 text-success" />
            {t("candidate.checks.passed", { count: passed.length, names: passed.map((c) => checkName(t, c.check)).join(", ") })}
          </p>
        ) : null}
        {gate ? <GateField gate={gate} document={project.document} /> : null}
        {candidate.testedSeams !== undefined ? <TestedSeamsField seams={candidate.testedSeams} /> : null}
        {candidate.technicalReview ? (
          <TechnicalReviewField review={candidate.technicalReview} />
        ) : (
          <p className="mt-2 text-ui-sm text-muted-foreground" data-testid="candidate-reviewers-none">
            {t("candidate.reviewers.none")}
          </p>
        )}
        {quality.length && !candidate.pullRequest ? <QualityField items={quality} /> : null}
        {conflicts.length && !superseded ? (
          <Field label={t("chat.card.candidate.comparisons")}>
            {conflicts.map((a) => (
              <div key={a.id} className="text-ui-sm">
                {withNodes(t("chat.card.candidate.conflictWith", { label: t(CONFLICT_LABEL[a.classification].label) }), {
                  references: <ReferenceText text={a.references.map(plainConflictReference).join(", ")} />,
                })}
              </div>
            ))}
          </Field>
        ) : null}
        {merged ? null : <CandidateOverlaps candidateId={candidate.id} />}
      </Block>
      <GoalExamplesSection candidateId={id} />
      <div ref={auditRef} className="scroll-mt-2">
        <AuditSection candidateId={id} auditId={audit} />
      </div>
      <Block title={t("candidate.history")} testId="candidate-history">
        <HistoryRow label={t("candidate.history.version")}>
          <span className="font-mono text-ui-xs" title={candidate.snapshotId}>
            {candidate.snapshotId.slice(0, 12)}
          </span>
        </HistoryRow>
        <HistoryRow label={t("candidate.history.assignment")}>
          <RecordName id={candidate.assignmentId} />
        </HistoryRow>
        {candidate.humanApproval || candidate.clearance ? (
          <HistoryRow label={t("candidate.history.approval")}>
            {candidate.humanApproval ? (
              <p>{report.approvalInvalidated ? t("candidate.history.approvalInvalidated") : t("candidate.history.approved", { time: formatRelativeTime(candidate.humanApproval.at) })}</p>
            ) : null}
            {candidate.clearance ? <p>{report.clearanceInvalidated ? t("chat.card.candidate.clearanceInvalidated") : t("chat.card.candidate.clearance")}</p> : null}
          </HistoryRow>
        ) : null}
        {candidate.pullRequest ? (
          <HistoryRow label={t("candidate.history.pullRequest")}>
            <button
              type="button"
              data-testid="candidate-pull-request"
              className="inline-flex min-h-8 items-center gap-2 text-[var(--color-text-accent)] hover:underline"
              onClick={() => void act("shell:openExternal", { url: candidate.pullRequest!.url })}
            >
              <IconGitPullRequest className="size-4" /> {t("chat.card.candidate.pullRequest", { number: String(candidate.pullRequest.number) })}
            </button>
          </HistoryRow>
        ) : null}
        {candidate.requiredDecisionIds.length ? (
          <HistoryRow label={t("chat.card.candidate.decisions")}>
            <div className="flex flex-wrap items-center gap-x-2">
              {candidate.requiredDecisionIds.map((decisionId) => (
                <DecisionLink key={decisionId} id={decisionId} version={candidate.decisionVersions[decisionId]} />
              ))}
            </div>
          </HistoryRow>
        ) : null}
      </Block>
    </div>
  );
}
