import type { CandidateGate, GateReview, ProjectDocument } from "@shared/domain";
import { GATE_STATUS, isGateRunning, isRegression, reviewOutcome } from "@shared/gate";
import { roleProfile } from "@shared/roster";
import { AgentName } from "@/components/AgentIdentity";
import { Spinner } from "@/components/Spinner";
import { Badge } from "@/components/ui/field";
import { Sep } from "@/components/ui/sep";
import { plainText } from "@shared/plainLanguage";
import { ReferenceText } from "./ReferenceText";

const RESULT: Record<"pass" | "fail" | "notRun", string> = { pass: "passa", fail: "fallisce", notRun: "non eseguita" };

const GATE_NOTE = "I rilievi sono il giudizio dei revisori, non un'evidenza. Le verifiche e il confronto della suite sono eseguiti da Trama.";

function ReviewRow({ review, document }: { review: GateReview; document: ProjectDocument }) {
  const figure = document.team.specialists.find((s) => s.role === review.role && s.status !== "removed");
  const outcome = reviewOutcome(review);
  const findings = [...review.findings].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "blocking" ? -1 : 1));
  return (
    <li data-testid="gate-review" data-role={review.role} data-status={review.status} className="py-1">
      <div className="flex min-w-0 items-center gap-2 text-ui-sm">
        {figure ? <AgentName agent={figure} size={20} className="min-w-0" /> : <span className="min-w-0 truncate">{roleProfile(review.role).name}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {review.status === "running" ? <Spinner /> : null}
          <Badge tone={outcome.tone}>{outcome.label}</Badge>
        </span>
      </div>
      {review.status === "skipped" && review.report ? <p className="mt-0.5 text-ui-sm text-muted-foreground">{plainText(review.report)}</p> : null}
      {review.status === "failed" ? <p className="mt-0.5 text-ui-sm text-destructive">{review.failure ?? "La revisione non è riuscita."}</p> : null}
      {findings.length ? (
        <ul className="mt-0.5 space-y-0.5 text-ui-sm">
          {findings.map((f) => (
            <li key={`${f.severity}-${f.title}-${f.file}`} data-testid="gate-finding" data-severity={f.severity} className="break-words">
              <span className={f.severity === "blocking" ? "text-destructive" : "text-muted-foreground"}>{f.severity === "blocking" ? "Bloccante" : "Suggerimento"}</span>
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
  const status = GATE_STATUS[gate.status];
  const guardian = gate.reviews.find((r) => r.role === "regressionGuardian");
  const developer = document.team.specialists.find((s) => s.assignments.some((a) => a.id === gate.assignmentId));
  return (
    <div className="mt-2" data-testid="candidate-gate" data-status={gate.status}>
      <div className="flex items-center gap-2">
        <span className="text-ui-xs text-muted-foreground/70">Revisori del candidato</span>
        <span className="ml-auto flex items-center gap-1.5">
          {isGateRunning(gate) ? <Spinner /> : null}
          <Badge tone={status.tone}>{status.label}</Badge>
        </span>
      </div>
      {gate.checksFailed.length ? (
        <p className="mt-0.5 text-ui-sm text-muted-foreground">
          Verifiche non superate: <span className="font-mono text-[11.5px]">{gate.checksFailed.join(", ")}</span>. I revisori del diff non sono partiti: la verifica fallita passa al debugger.
        </p>
      ) : null}
      {gate.status === "failed" && gate.failure ? <p className="mt-0.5 text-ui-sm text-destructive">{gate.failure}</p> : null}
      <ul className="mt-0.5 divide-y divide-border/60">
        {gate.reviews
          .filter((r) => !(gate.checksFailed.length && r.status === "skipped"))
          .map((review) => (
            <ReviewRow key={review.role} review={review} document={document} />
          ))}
      </ul>
      {gate.suite.length && guardian ? (
        <div className="mt-1" data-testid="gate-suite">
          <div className="text-ui-xs text-muted-foreground/70">Suite sulla base e sul candidato</div>
          <ul className="space-y-0.5 text-ui-sm">
            {gate.suite.map((c) => (
              <li key={c.check} data-testid="gate-suite-check" data-check={c.check} data-regression={isRegression(c) ? "yes" : "no"}>
                <span className="font-mono text-[11.5px]">{c.check}</span>
                <Sep />
                base {RESULT[c.base]}
                <Sep />
                candidato {RESULT[c.candidate]}
                {isRegression(c) ? (
                  <>
                    <Sep />
                    <span className="text-destructive">regressione</span>
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
            ? `I rilievi bloccanti aspettano ${developer?.name ?? "lo sviluppatore"}: ${gate.returned.waiting}`
            : `Rimandato a ${developer?.name ?? "lo sviluppatore"} con i rilievi bloccanti: riprende il lavoro nel suo worktree.`}
        </p>
      ) : null}
      <p className="mt-1 text-ui-xs text-muted-foreground">{GATE_NOTE}</p>
    </div>
  );
}
