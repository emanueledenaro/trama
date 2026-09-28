import type { Specialist, SpecialistAssignment } from "@shared/domain";
import { CLOUD_STATUS, canMovePlace, cloudEligible, cloudWorking, offersCloud } from "@shared/workPlace";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { Sep } from "@/components/ui/sep";
import { act } from "@/lib/store";

const CHOSEN_BY = { setting: "Impostazione del progetto", coordinator: "Scelta del Coordinatore", person: "Scelta tua" } as const;

/**
 * Where the work runs (A19, issue #260): local or in a cloud session, who chose it and why, the step that enables the
 * cloud when it could not be used, and the session's link and state. Nothing for work that never had a choice.
 */
export function PlaceField({ specialist, assignment }: { specialist: Specialist; assignment: SpecialistAssignment }) {
  const place = assignment.place ?? null;
  const cloud = assignment.cloud ?? null;
  if (!place && !cloud) return null;
  const inCloud = place?.where === "cloud";
  const status = cloud ? CLOUD_STATUS[cloud.status] : null;
  const next = assignment.placeChoice && canMovePlace(assignment) && assignment.placeChoice !== place?.where ? assignment.placeChoice : null;
  return (
    <div className="mt-2">
      <div className="text-ui-xs text-muted-foreground/70">Luogo di lavoro</div>
      <div className="mt-0.5 text-ui text-foreground/90" data-testid="assignment-place" data-place={place?.where ?? "local"}>
        <span>{inCloud ? "In cloud, in una sessione di Claude Code" : "In locale, sul Mac"}</span>
        {place ? (
          <span className="text-muted-foreground">
            <Sep />
            {CHOSEN_BY[place.chosenBy]}
          </span>
        ) : null}
        {place ? <div className="mt-0.5 text-ui-sm text-muted-foreground">{place.reason}</div> : null}
        {place?.cloudBlocked ? (
          <div className="mt-0.5 text-ui-sm text-muted-foreground" data-testid="assignment-place-enable">
            Per usare il cloud: {place.cloudBlocked.enable}
          </div>
        ) : null}
        {next ? <div className="mt-0.5 text-ui-sm text-foreground/90">Alla prossima ripresa lavora {next === "cloud" ? "in cloud" : "in locale"}, come hai scelto.</div> : null}
        {cloud && status ? (
          <div className="mt-1.5 space-y-1 rounded-lg border border-[color:var(--color-border)] px-3 py-2" data-testid="cloud-session" data-status={cloud.status}>
            <div className="flex flex-wrap items-center gap-1.5 text-ui-sm">
              <span className="text-muted-foreground">Sessione cloud</span>
              <Badge tone={status.tone}>{status.label}</Badge>
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-ui-sm">
              {cloud.url ? (
                <button type="button" className="text-[var(--color-text-accent)] hover:underline" onClick={() => void act("shell:openExternal", { url: cloud.url! })}>
                  Apri la sessione
                </button>
              ) : null}
              {cloud.pullRequest ? (
                <button type="button" className="text-[var(--color-text-accent)] hover:underline" onClick={() => void act("shell:openExternal", { url: cloud.pullRequest!.url })}>
                  Pull request #{cloud.pullRequest.number}
                  {cloud.pullRequest.draft ? " in bozza" : ""}
                </button>
              ) : null}
            </div>
            {cloud.failure ? <div className="text-ui-sm text-destructive">{cloud.failure}</div> : null}
            {cloud.macChecks ? (
              cloud.macChecks.problems.length ? (
                <div className="text-ui-sm text-destructive" data-testid="cloud-mac-checks" data-passed="no">
                  Controlli sul Mac non superati: {cloud.macChecks.problems.join(" ")}
                </div>
              ) : (
                <div className="text-ui-sm text-muted-foreground" data-testid="cloud-mac-checks" data-passed="yes">
                  Controlli sul Mac superati: niente segreti né file sensibili, git diff --check pulito, messaggi di commit validi.
                </div>
              )
            ) : null}
            {cloud.status === "stopped" ? <div className="text-ui-sm text-muted-foreground">La sessione si ferma dalla sua pagina di Claude Code.</div> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The person's moves of the work between local and cloud (Q30), and the check of a running session, for the cta row. */
export function PlaceActions({ specialist, assignment }: { specialist: Specialist; assignment: SpecialistAssignment }) {
  if (!cloudEligible(specialist, assignment)) return null;
  if (cloudWorking(assignment) && assignment.status === "running") {
    return (
      <Button size="sm" variant="outline" onClick={() => void act("assignment:cloudCheck", { assignmentId: assignment.id })}>
        Controlla la sessione
      </Button>
    );
  }
  if (!canMovePlace(assignment)) return null;
  const where = assignment.placeChoice ?? assignment.place?.where ?? "local";
  const hasLocalWork = Boolean(assignment.workspace && !assignment.workspaceRemovedAt);
  if (where === "local" && (hasLocalWork || !offersCloud(assignment.provider))) return null;
  return (
    <Button size="sm" variant="outline" onClick={() => void act("assignment:place", { assignmentId: assignment.id, where: where === "cloud" ? "local" : "cloud" })}>
      {where === "cloud" ? "Sposta in locale" : "Sposta in cloud"}
    </Button>
  );
}
