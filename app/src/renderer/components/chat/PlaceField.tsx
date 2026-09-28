import type { Specialist, SpecialistAssignment } from "@shared/domain";
import { CLOUD_STATUS_TONE, canMovePlace, cloudEligible, cloudWorking, offersCloud } from "@shared/workPlace";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { Sep } from "@/components/ui/sep";
import { useT } from "@/lib/i18n";
import { act } from "@/lib/store";

/**
 * Where the work runs (A19, issue #260): local or in a cloud session, who chose it and why, the step that enables the
 * cloud when it could not be used, and the session's link and state. Nothing for work that never had a choice.
 */
export function PlaceField({ assignment }: { assignment: SpecialistAssignment }) {
  const t = useT();
  const place = assignment.place ?? null;
  const cloud = assignment.cloud ?? null;
  if (!place && !cloud) return null;
  const inCloud = place?.where === "cloud";

  const next = assignment.placeChoice && canMovePlace(assignment) && assignment.placeChoice !== place?.where ? assignment.placeChoice : null;
  return (
    <div className="mt-2">
      <div className="text-ui-xs text-muted-foreground/70">{t("workPlace.label")}</div>
      <div className="mt-0.5 text-ui text-foreground/90" data-testid="assignment-place" data-place={place?.where ?? "local"}>
        <span>{inCloud ? t("workPlace.cloud") : t("workPlace.local")}</span>
        {place ? (
          <span className="text-muted-foreground">
            <Sep />
            {t(`workPlace.chosenBy.${place.chosenBy}`)}
          </span>
        ) : null}
        {place ? <div className="mt-0.5 text-ui-sm text-muted-foreground">{place.reason}</div> : null}
        {place?.cloudBlocked ? (
          <div className="mt-0.5 text-ui-sm text-muted-foreground" data-testid="assignment-place-enable">
            {t("workPlace.enable", { step: place.cloudBlocked.enable })}
          </div>
        ) : null}
        {next ? <div className="mt-0.5 text-ui-sm text-foreground/90">{t(`workPlace.next.${next}`)}</div> : null}
        {cloud ? (
          <div className="mt-1.5 space-y-1 rounded-lg border border-[color:var(--color-border)] px-3 py-2" data-testid="cloud-session" data-status={cloud.status}>
            <div className="flex flex-wrap items-center gap-1.5 text-ui-sm">
              <span className="text-muted-foreground">{t("cloudSession.label")}</span>
              <Badge tone={CLOUD_STATUS_TONE[cloud.status]}>{t(`cloudSession.status.${cloud.status}`)}</Badge>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-ui-sm">
              {cloud.url ? (
                <button type="button" className="text-[var(--color-text-accent)] hover:underline" onClick={() => void act("shell:openExternal", { url: cloud.url! })}>
                  {t("cloudSession.open")}
                </button>
              ) : null}
              {cloud.pullRequest ? (
                <button type="button" className="text-[var(--color-text-accent)] hover:underline" onClick={() => void act("shell:openExternal", { url: cloud.pullRequest!.url })}>
                  {t(cloud.pullRequest.draft ? "cloudSession.pullRequestDraft" : "cloudSession.pullRequest", { number: String(cloud.pullRequest.number) })}
                </button>
              ) : null}
            </div>
            {cloud.failure ? <div className="text-ui-sm text-destructive">{cloud.failure}</div> : null}
            {cloud.macChecks ? (
              cloud.macChecks.problems.length ? (
                <div className="text-ui-sm text-destructive" data-testid="cloud-mac-checks" data-passed="no">
                  {t("cloudSession.checksFailed", { problems: cloud.macChecks.problems.join(" ") })}
                </div>
              ) : (
                <div className="text-ui-sm text-muted-foreground" data-testid="cloud-mac-checks" data-passed="yes">
                  {t("cloudSession.checksPassed")}
                </div>
              )
            ) : null}
            {cloud.status === "stopped" ? <div className="text-ui-sm text-muted-foreground">{t("cloudSession.stoppedHint")}</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The person's moves of the work between local and cloud (Q30), and the check of a running session, for the cta row. */
export function PlaceActions({ specialist, assignment }: { specialist: Specialist; assignment: SpecialistAssignment }) {
  const t = useT();
  if (!cloudEligible(specialist, assignment)) return null;
  if (cloudWorking(assignment) && assignment.status === "running") {
    return (
      <Button size="sm" variant="outline" onClick={() => void act("assignment:cloudCheck", { assignmentId: assignment.id })}>
        {t("cloudSession.check")}
      </Button>
    );
  }
  if (!canMovePlace(assignment)) return null;
  const where = assignment.placeChoice ?? assignment.place?.where ?? "local";
  const hasLocalWork = Boolean(assignment.workspace && !assignment.workspaceRemovedAt);
  if (where === "local" && (hasLocalWork || !offersCloud(assignment.provider))) return null;
  return (
    <Button size="sm" variant="outline" onClick={() => void act("assignment:place", { assignmentId: assignment.id, where: where === "cloud" ? "local" : "cloud" })}>
      {where === "cloud" ? t("workPlace.moveToLocal") : t("workPlace.moveToCloud")}
    </Button>
  );
}
