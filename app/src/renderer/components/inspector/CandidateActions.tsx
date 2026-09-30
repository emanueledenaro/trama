import { IconGitMerge, IconGitPullRequest } from "@tabler/icons-react";
import { useState } from "react";
import type { Candidate, CandidateReport } from "@shared/domain";
import type { ActionResult } from "@shared/ipc";
import { Button } from "@/components/ui/button";
import { TextArea } from "@/components/ui/field";
import { useT } from "@/lib/i18n";
import { act } from "@/lib/store";
import { MergeStopActions } from "./CandidateFields";

/**
 * What the person can do with a candidate, right under its outcome (issue #314): on the right, the primary last. Every
 * button is a text button drawn as an outline: approving and refusing are neutral, and the page has no filled button.
 * Only actions that exist show: Trama has no "ask the Coordinator to correct it" for a candidate, so there is none.
 */
export function CandidateActions({
  candidate,
  report,
  repository,
  publishable,
}: {
  candidate: Candidate;
  report: CandidateReport;
  repository: string | null;
  publishable: boolean;
}) {
  const t = useT();
  const candidateId = candidate.id;
  const [preview, setPreview] = useState<ActionResult<"candidate:previewPullRequest"> | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [rejection, setRejection] = useState("");
  const superseded = report.state === "superseded";
  const approved = Boolean(candidate.humanApproval) && !report.approvalInvalidated;
  const route = report.mergeRoute ?? "person";
  const open = report.blockers.length === 0 && !superseded && !candidate.pullRequest?.mergedAt;
  // An interface candidate waits for the person's ok; a destructive change the Coordinator stopped waits for their choice.
  const decidable = route === "interface" && open && !approved && !candidate.humanRejection;
  const stop = candidate.merge?.status === "stopped" ? (candidate.merge.stop ?? null) : null;
  const canApprove = route === "person" && report.blockers.length === 0 && !approved && !superseded;
  const canPrepare = route === "person" && approved && publishable && !superseded && !candidate.pullRequest && Boolean(repository) && !preview;
  const stopped = Boolean(stop && open && !approved);
  if (!canApprove && !decidable && !stopped && !canPrepare && !preview) return null;
  return (
    <div>
      {decidable && rejecting ? null : (
        <div className="cta-row" data-testid="candidate-actions">
          {canApprove ? (
            <Button variant="outline" onClick={() => void act("candidate:approve", { candidateId })}>
              {t("chat.card.candidate.approve")}
            </Button>
          ) : null}
          {decidable ? (
            <>
              <Button variant="outline" onClick={() => setRejecting(true)}>
                {t("chat.card.candidate.reject")}
              </Button>
              <Button variant="outline" onClick={() => void act("candidate:approve", { candidateId })}>
                <IconGitMerge /> {t("chat.card.candidate.approveAndMerge")}
              </Button>
            </>
          ) : null}
          {stopped && stop ? <MergeStopActions candidateId={candidateId} declined={Boolean(stop.acknowledgedAt)} /> : null}
          {canPrepare ? (
            <Button variant="outline" onClick={() => void act("candidate:previewPullRequest", { candidateId }).then((p) => setPreview(p ?? null))}>
              <IconGitPullRequest /> {t("chat.card.candidate.preparePullRequest")}
            </Button>
          ) : null}
        </div>
      )}
      {decidable && rejecting ? (
        <div className="space-y-2">
          <TextArea
            value={rejection}
            onChange={(e) => setRejection(e.target.value)}
            placeholder={t("chat.card.candidate.rejectPlaceholder")}
            aria-label={t("chat.card.candidate.rejectLabel")}
            className="min-h-12"
            autoFocus
          />
          <div className="cta-row">
            <Button variant="ghost" onClick={() => setRejecting(false)}>
              {t("chat.card.cancel")}
            </Button>
            <Button variant="outline" disabled={!rejection.trim()} onClick={() => void act("candidate:reject", { candidateId, note: rejection.trim() }).then(() => setRejecting(false))}>
              {t("chat.card.candidate.rejectConfirm")}
            </Button>
          </div>
        </div>
      ) : null}
      {preview && !candidate.pullRequest ? (
        <div className="space-y-2 rounded-lg border border-[color:var(--color-border)] p-4 text-ui-sm">
          <p className="text-muted-foreground">
            {preview.repository} · <span className="font-mono">{preview.head}</span> → <span className="font-mono">{preview.base}</span>
          </p>
          <p className="font-medium text-foreground" data-testid="pull-request-title">
            {preview.title}
          </p>
          <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--app-chat-code-surface)] px-2 py-2 font-mono text-ui-xs text-foreground/85" data-testid="commit-message">
            {preview.message}
          </pre>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-sans text-ui-xs text-foreground/85">{preview.body}</pre>
          <div className="cta-row">
            <Button variant="ghost" onClick={() => setPreview(null)}>
              {t("chat.card.cancel")}
            </Button>
            <Button variant="outline" onClick={() => void act("candidate:publish", { candidateId }).then(() => setPreview(null))}>
              <IconGitPullRequest /> {t("chat.card.candidate.publish")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
