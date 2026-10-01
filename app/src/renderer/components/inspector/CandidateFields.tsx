import { IconCircleCheck, IconCircleX, IconGitMerge } from "@/components/icons";
import { cleanCodeRules, type CodeMeasure } from "@shared/cleanCode";
import type { Candidate, MergeRoute, MergeStop, QualityItem, TechnicalReview, TestedSeam } from "@shared/domain";
import type { MessageKey, Translate } from "@shared/i18n";
import { compareSides } from "@shared/overlap";
import { Field } from "@/components/chat/Cards";
import { ReferenceText } from "@/components/chat/ReferenceText";
import { RuleLabel } from "@/components/chat/RuleLabel";
import { OverlapRow } from "@/components/OverlapNotice";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { Sep } from "@/components/ui/sep";
import { cn } from "@/lib/cn";
import { useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";
import { useRecord } from "@/lib/references";

/*
 * The fields of a candidate, as the card in the chat draws them, for the candidate's own page. They live in
 * `components/chat/Cards.tsx` without being exported; that file is the Coordinator's, so these are copies with the same
 * `data-testid`s. When Cards.tsx exports them (or its "detail" layout is removed), delete this file and import them.
 */

/** Blockers whose detail is the name of a check. */
export const CHECK_BLOCKERS = new Set(["EVIDENCE_MISSING", "EVIDENCE_STALE", "CHECK_FAILED"]);

export const QUALITY_LABEL: Record<QualityItem["code"], MessageKey> = {
  VERIFIED: "chat.card.quality.VERIFIED",
  COMMIT_MESSAGE: "chat.card.quality.COMMIT_MESSAGE",
  NO_SECRETS: "chat.card.quality.NO_SECRETS",
  DIFF_CHECK: "chat.card.quality.DIFF_CHECK",
  ISSUE_LINKED: "chat.card.quality.ISSUE_LINKED",
  PACT_SETTLED: "chat.card.quality.PACT_SETTLED",
  MANDATE: "chat.card.quality.MANDATE",
};

/** The quality standard before publishing (Q01): each condition, and for a missing one what to do. */
export function QualityField({ items }: { items: QualityItem[] }) {
  const t = useT();
  const missing = items.filter((i) => !i.passed).length;
  return (
    <Field label={missing ? t("chat.card.quality.missing", { count: missing }) : t("chat.card.quality.met")}>
      <ul className="space-y-1" data-testid="candidate-quality" data-ready={missing ? "no" : "yes"}>
        {items.map((item) => (
          <li key={item.code} data-testid="quality-item" data-code={item.code} data-passed={item.passed ? "yes" : "no"} className="text-ui-sm">
            <div className="flex items-start gap-2">
              {item.passed ? <IconCircleCheck className="mt-0.5 size-4 shrink-0 text-success" /> : <IconCircleX className="mt-0.5 size-4 shrink-0 text-destructive" />}
              <span className="min-w-0">
                <span className="text-foreground">{t(QUALITY_LABEL[item.code])}</span>
                <span className={cn("text-muted-foreground", item.code === "COMMIT_MESSAGE" && item.passed && "font-mono text-ui-xs")}>
                  <Sep />
                  {item.code === "COMMIT_MESSAGE" ? item.detail : <ReferenceText text={item.detail} />}
                </span>
                {item.fix ? <span className="block text-ui-xs text-muted-foreground">{t("chat.card.quality.fix", { fix: item.fix })}</span> : null}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </Field>
  );
}

const STATEMENT_NOTE: MessageKey = "chat.card.report.statementNote";

/** Seams as the developer reported them (M06, W05), each with its tests or none, and marked when outside the agreed ones. */
function TestedSeamList({ seams, itemTestId, outside }: { seams: TestedSeam[]; itemTestId: string; outside: string }) {
  const t = useT();
  return (
    <ul className="space-y-0.5 text-ui-sm">
      {seams.map((s) => (
        <li key={`${s.seam}-${s.tests}`} data-testid={itemTestId} data-tested={s.tests ? "yes" : "no"} data-agreed={s.agreed ? "yes" : "no"}>
          {s.seam}
          <span className="text-muted-foreground">
            <Sep />
            {s.tests ? t("chat.card.seams.tests", { tests: s.tests }) : t("chat.card.seams.noTests")}
            {s.agreed ? null : `, ${outside}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The seams the developer of a slice says it tested (M06): its statement, shown apart from Trama's evidence. */
export function TestedSeamsField({ seams }: { seams: TestedSeam[] | null }) {
  const t = useT();
  return (
    <Field label={t("chat.card.seams.tested")}>
      <div data-testid="candidate-tested-seams">
        {seams === null ? (
          <p className="text-ui-sm text-muted-foreground">{t("chat.card.seams.notReported")}</p>
        ) : seams.length === 0 ? (
          <p className="text-ui-sm text-muted-foreground">{t("chat.card.seams.noneConfirmed")}</p>
        ) : (
          <TestedSeamList seams={seams} itemTestId="candidate-tested-seam" outside={t("chat.card.seams.outsideConfirmed")} />
        )}
        <p className="mt-1 text-ui-xs text-muted-foreground">{t(STATEMENT_NOTE)}</p>
      </div>
    </Field>
  );
}

const MEASURE_TEXT: Record<CodeMeasure["kind"], (m: CodeMeasure, t: Translate) => string> = {
  arguments: (m, t) => t("chat.card.measure.arguments", { subject: m.subject, value: m.value, limit: m.limit }),
  functionLength: (m, t) => t("chat.card.measure.functionLength", { subject: m.subject, value: m.value, limit: m.limit }),
  duplication: (m, t) => t("chat.card.measure.duplication", { subject: m.subject, value: m.value }),
};

const REVIEW_NOTE: MessageKey = "chat.card.review.note";

/** The technical review (V05) with the findings against the Clean Code standard and Trama's own measures (Q03). */
export function TechnicalReviewField({ review }: { review: TechnicalReview }) {
  const t = useT();
  const findings = [...(review.findings ?? [])].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "blocking" ? -1 : 1));
  const standard = review.standard;
  const ruleLabel = (id: string | null) => {
    const rule = cleanCodeRules(t).find((r) => r.id === id);
    return rule ? <RuleLabel rule={rule} /> : t("chat.card.review.otherRule");
  };
  return (
    <Field label={review.verdict === "approved" ? t("chat.card.review.approved") : t("chat.card.review.changesRequested")}>
      <div data-testid="technical-review" data-verdict={review.verdict}>
        {/* With the candidate gate (W10) the summary is the gate's, shown figure by figure above. */}
        {review.gateId ? null : <p>{review.summary}</p>}
        {standard ? (
          <div className="mt-2" data-testid="review-measures">
            <div className="text-ui-xs text-muted-foreground/70">
              {t("chat.card.review.measures", { version: standard.version, files: t("chat.card.files", { count: standard.filesMeasured }) })}
              <Sep />
              {t("chat.card.review.functions", { count: standard.functionsMeasured })}
            </div>
            {standard.measures.length ? (
              <ul className="space-y-0.5 text-ui-sm">
                {standard.measures.map((m) => (
                  <li key={`${m.kind}-${m.file}-${m.line}`} data-testid="review-measure" data-kind={m.kind} className="break-words">
                    <span className="font-mono text-ui-xs">
                      {m.file}:{m.line}
                    </span>
                    <Sep />
                    {MEASURE_TEXT[m.kind](m, t)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ui-sm text-muted-foreground">{t("chat.card.review.noMeasures")}</p>
            )}
          </div>
        ) : null}
        {review.findings !== undefined ? (
          <div className="mt-2" data-testid="review-findings">
            <div className="text-ui-xs text-muted-foreground/70">{t("chat.card.review.findings")}</div>
            {findings.length ? (
              <ul className="space-y-1 text-ui-sm">
                {findings.map((f) => (
                  <li key={`${f.file}-${f.line}-${f.message}`} data-testid="review-finding" data-severity={f.severity} className="break-words">
                    <span className="mr-2 inline-flex items-center gap-2 align-middle">
                      <Badge tone={f.severity === "blocking" ? "destructive" : "info"}>{f.severity === "blocking" ? t("chat.card.review.blocking") : t("chat.card.review.suggestion")}</Badge>
                      <span className="font-mono text-ui-xs text-foreground/90">
                        {f.file}
                        {f.line ? `:${f.line}` : ""}
                      </span>
                    </span>
                    <span className="text-muted-foreground">{ruleLabel(f.rule)}</span>
                    <Sep />
                    {f.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-ui-sm text-muted-foreground">{t("chat.card.review.noFindings")}</p>
            )}
            <p className="mt-1 text-ui-xs text-muted-foreground">{t(REVIEW_NOTE)}</p>
          </div>
        ) : null}
      </div>
    </Field>
  );
}

/**
 * Where the candidate stands on its way to the main branch (issue #247): merged and on whose authority, waiting for
 * the checks of its pull request, stopped, or who handles it.
 */
export function MergeLine({ candidate, route, routeReason, open, approved }: { candidate: Candidate; route: MergeRoute; routeReason: string | null; open: boolean; approved: boolean }) {
  const t = useT();
  const merge = candidate.merge;
  const pull = candidate.pullRequest;
  let text: string | null = null;
  let tone = "text-muted-foreground";
  if (pull?.mergedAt) {
    text = pull.mergedBy === "coordinator" ? t("chat.card.merge.byCoordinator") : pull.mergedBy === "person" ? t("chat.card.merge.byPerson") : t("chat.card.merge.onGitHub");
  } else if (merge && open && merge.status !== "merged") {
    // A destructive stop says it in its own field, with consequences and alternatives (issue #41).
    text = merge.status === "running" ? t("chat.card.merge.running") : merge.stop ? null : merge.detail;
    if (merge.status === "failed" || merge.status === "stopped") tone = "text-destructive";
  } else if (open && candidate.humanRejection) {
    text = t("chat.card.merge.rejected", { note: candidate.humanRejection.note });
  } else if (open && route === "coordinator") {
    text = candidate.clearance ? t("chat.card.merge.cleared") : t("chat.card.merge.onClearance");
  } else if (open && route === "interface") {
    text = approved
      ? candidate.clearance
        ? t("chat.card.merge.approved")
        : t("chat.card.merge.approvedAwaitingClearance")
      : t("chat.card.merge.interface");
  } else if (open && routeReason) {
    text = routeReason;
  }
  if (!text) return null;
  return (
    <p className={cn("mt-2 text-ui-sm", tone)} data-testid="candidate-merge" data-route={route} data-status={pull?.mergedAt ? "merged" : (merge?.status ?? "none")}>
      {text}
      {pull?.mergedAt && pull.mergedBy === "coordinator" && merge?.mandateVersion ? <MergeMandate version={merge.mandateVersion} /> : null}
    </p>
  );
}

/**
 * A merge the Coordinator stopped because it destroys something (issue #41): the reasons, what happens and what the
 * person can do. The texts of the stop are Trama's records, in Italian.
 */
export function MergeStopField({ stop }: { stop: MergeStop }) {
  const t = useT();
  return (
    <div className="mt-2 space-y-1 text-ui-sm" data-testid="candidate-merge-stop">
      <p className="text-foreground/90">
        {t("mergeStop.title")} {stop.reasons.join(" ")}
      </p>
      <p className="font-medium text-foreground">{t("mergeStop.consequences")}</p>
      <ul className="list-disc space-y-0.5 pl-4">
        {stop.consequences.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <p className="font-medium text-foreground">{t("mergeStop.alternatives")}</p>
      <ul className="list-disc space-y-0.5 pl-4">
        {stop.alternatives.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
      {stop.acknowledgedAt ? <p className="text-muted-foreground">{t("mergeStop.declined")}</p> : null}
    </div>
  );
}

/** The person's choice on a stopped merge: leave it, or merge it with their ok (issue #41). Primary last. */
export function MergeStopActions({ candidateId, declined }: { candidateId: string; declined: boolean }) {
  const t = useT();
  return (
    <>
      {declined ? null : (
        <Button variant="outline" onClick={() => void act("candidate:declineMerge", { candidateId })}>
          {t("mergeStop.decline")}
        </Button>
      )}
      <Button variant="outline" onClick={() => void act("candidate:approve", { candidateId })}>
        <IconGitMerge /> {t("mergeStop.merge")}
      </Button>
    </>
  );
}

/** The mandate a merge on the Coordinator's green light ran under (issue #41). */
function MergeMandate({ version }: { version: number }) {
  const t = useT();
  return <span data-testid="candidate-merge-mandate"> {t("merge.mandateVersion", { version })}</span>;
}

/**
 * A decision the work relies on, by what that version decided, with its version; the id on hover (issue #270). A
 * decision changed since then shows the words of the version the work used, not the current ones.
 */
export function DecisionLink({ id, version }: { id: string; version: number | undefined }) {
  const t = useT();
  const setInspector = useUi((s) => s.setInspector);
  const record = useRecord(id);
  const used = useUi((s) => {
    const document = s.app?.project?.document;
    if (!document || version === undefined) return null;
    return [...document.decisions, ...document.decisionHistory].find((d) => d.id === id && d.version === version) ?? null;
  });
  const words = used ? `«${used.value.length > 48 ? `${used.value.slice(0, 47).trimEnd()}…` : used.value}»` : (record?.short ?? id);
  return (
    <button type="button" title={id} className="mr-2 inline-flex min-h-8 items-center text-ui-sm text-[var(--color-text-accent)] hover:underline" onClick={() => setInspector({ kind: "decision", id })}>
      {words}
      {version !== undefined ? t("chat.card.decisionLink.version", { version }) : ""}
    </button>
  );
}

/**
 * G03, before publishing or merging (decision 4): the candidate's files against the colleagues' presence, with the
 * conflicts the merge probes found. A warning, never a lock: the buttons stay where they are.
 */
export function CandidateOverlaps({ candidateId }: { candidateId: string }) {
  const t = useT();
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
    <Field label={candidate.pullRequest ? t("chat.card.overlaps.beforeMerge") : t("chat.card.overlaps.beforePublish")}>
      <div data-testid="candidate-overlaps" className="divide-y divide-[color:var(--app-surface-divider)]">
        {items.map((item) => (
          <OverlapRow key={item.id} item={item} />
        ))}
      </div>
    </Field>
  );
}

export const CONFLICT_LABEL = {
  conflict: { label: "chat.card.conflict.conflict", tone: "destructive" as const },
  overlap: { label: "chat.card.conflict.overlap", tone: "warning" as const },
  clean: { label: "chat.card.conflict.clean", tone: "success" as const },
  unknown: { label: "chat.card.conflict.unknown", tone: "secondary" as const },
  hypothesis: { label: "chat.card.conflict.hypothesis", tone: "info" as const },
  semantic: { label: "chat.card.conflict.semantic", tone: "destructive" as const },
} satisfies Record<string, { label: MessageKey; tone: string }>;
