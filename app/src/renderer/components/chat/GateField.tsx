import { checkName } from "@shared/states";
import type { CandidateGate, GateReview, ProjectDocument } from "@shared/domain";
import { gateRowFindings, gateStatus, isGateRunning, isRegression, reviewOutcome } from "@shared/gate";
import { roleProfile } from "@shared/roster";
import { AgentName } from "@/components/AgentIdentity";
import { Spinner } from "@/components/Spinner";
import { Badge } from "@/components/ui/field";
import { Sep } from "@/components/ui/sep";
import type { MessageKey } from "@shared/i18n";
import { plainText } from "@shared/plainLanguage";
import { useT } from "@/lib/i18n";
import { ReferenceText } from "./ReferenceText";

const RESULT: Record<"pass" | "fail" | "notRun", MessageKey> = { pass: "shared.suite.pass", fail: "shared.suite.fail", notRun: "shared.suite.notRun" };

function ReviewRow({ gate, review, document }: { gate: CandidateGate; review: GateReview; document: ProjectDocument }) {
  const t = useT();
  const figure = document.team.specialists.find((s) => s.role === review.role && s.status !== "removed");
  const outcome = reviewOutcome(t, review);
  const candidate = document.candidates.find((c) => c.id === gate.candidateId);
  const findings = [...gateRowFindings(gate, review, candidate)].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "blocking" ? -1 : 1));
  return (
    <li data-testid="gate-review" data-role={review.role} data-status={review.status} className="py-1">
      {/* In a narrow side bar the name and its tag shorten with an ellipsis and never run over the badge; when even a
          shortened name leaves no room, the badge moves under it, whole and on the right. */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-ui-sm" data-testid="gate-review-head">
        <span className="flex min-w-0 flex-[1_1_9rem] items-center" data-testid="gate-review-who">
          {figure ? <AgentName agent={figure} size={20} className="min-w-0" fit /> : <span className="min-w-0 truncate">{roleProfile(t, review.role).name}</span>}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5" data-testid="gate-review-outcome">
          {review.status === "running" ? <Spinner /> : null}
          <Badge tone={outcome.tone}>{outcome.label}</Badge>
        </span>
      </div>
      {review.status === "skipped" && review.report ? <p className="mt-0.5 text-ui-sm text-muted-foreground">{plainText(t, review.report)}</p> : null}
      {review.status === "failed" ? <p className="mt-0.5 text-ui-sm text-destructive">{review.failure ?? t("chat.gate.reviewFailed")}</p> : null}
      {findings.length ? (
        <ul className="mt-0.5 space-y-0.5 text-ui-sm">
          {findings.map((f) => (
            <li key={`${f.severity}-${f.title}-${f.file}`} data-testid="gate-finding" data-severity={f.severity} className="break-words">
              <span className={f.severity === "blocking" ? "text-destructive" : "text-muted-foreground"}>{f.severity === "blocking" ? t("chat.gate.blocking") : t("chat.gate.suggestion")}</span>
              <Sep />
              <ReferenceText text={f.title} />
              {f.file ? (
                <>
                  <Sep />
                  <span className="font-mono text-[11.5px]">{f.file}</span>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/**
 * The candidate gate on the candidate card (W10): Trama's checks first, then each candidate figure of the team with
 * its outcome, the suite on the base and on the candidate, and whether the work went back to its developer.
 */
export function GateField({ gate, document }: { gate: CandidateGate; document: ProjectDocument }) {
  const t = useT();
  const status = gateStatus(t, gate.status);
  const guardian = gate.reviews.find((r) => r.role === "regressionGuardian");
  const developer = document.team.specialists.find((s) => s.assignments.some((a) => a.id === gate.assignmentId));
  return (
    <div className="mt-2" data-testid="candidate-gate" data-status={gate.status}>
      <div className="flex items-center gap-2">
        <span className="text-ui-xs text-muted-foreground/70">{t("chat.gate.reviewers")}</span>
        <span className="ml-auto flex items-center gap-1.5">
          {isGateRunning(gate) ? <Spinner /> : null}
          <Badge tone={status.tone}>{status.label}</Badge>
        </span>
      </div>
      {gate.checksFailed.length ? (
        <p className="mt-0.5 text-ui-sm text-muted-foreground">
          {t("chat.gate.checksFailed", { checks: gate.checksFailed.map((check) => checkName(t, check)).join(", ") })}
        </p>
      ) : null}
      {gate.status === "failed" && gate.failure ? <p className="mt-0.5 text-ui-sm text-destructive">{gate.failure}</p> : null}
      <ul className="mt-0.5 divide-y divide-border/60">
        {gate.reviews
          .filter((r) => !(gate.checksFailed.length && r.status === "skipped"))
          .map((review) => (
            <ReviewRow key={review.role} gate={gate} review={review} document={document} />
          ))}
      </ul>
      {gate.suite.length && guardian ? (
        <div className="mt-1" data-testid="gate-suite">
          <div className="text-ui-xs text-muted-foreground/70">{t("chat.gate.suite")}</div>
          <ul className="space-y-0.5 text-ui-sm">
            {gate.suite.map((c) => (
              <li key={c.check} data-testid="gate-suite-check" data-check={c.check} data-regression={isRegression(c) ? "yes" : "no"}>
                <span title={c.check}>{checkName(t, c.check)}</span>
                <Sep />
                {t("chat.gate.base", { result: t(RESULT[c.base]) })}
                <Sep />
                {t("chat.gate.candidate", { result: t(RESULT[c.candidate]) })}
                {isRegression(c) ? (
                  <>
                    <Sep />
                    <span className="text-destructive">{t("chat.gate.regression")}</span>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {gate.returned ? (
        <p className="mt-1 text-ui-sm" data-testid="gate-returned" data-waiting={gate.returned.waiting ? "yes" : "no"}>
          {gate.returned.waiting
            ? t("chat.gate.returnedWaiting", { name: developer?.name ?? t("chat.gate.theDeveloper"), waiting: gate.returned.waiting })
            : t("chat.gate.returned", { name: developer?.name ?? t("chat.gate.theDeveloper") })}
        </p>
      ) : null}
      <p className="mt-1 text-ui-xs text-muted-foreground">{t("chat.gate.note")}</p>
    </div>
  );
}
