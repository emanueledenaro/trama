import { ReferenceText } from "@/components/chat/ReferenceText";
import { IconPlayerPlay } from "@tabler/icons-react";
import { useState } from "react";
import type { AutomaticWorkStatus, TeamRole } from "@shared/domain";
import { AUTOMATIC_WORK_LABEL, AUTOMATIC_WORK_STATE } from "@shared/duties";
import { roleProfile } from "@shared/roster";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { Sep } from "@/components/ui/sep";
import { act, useUi } from "@/lib/store";
import { InspectorSection } from "./Inspector";

/** The CTA of work the person may start now; a triage starts from its issue, so here it only says where. */
function StartNow({ work }: { work: AutomaticWorkStatus }) {
  const [starting, setStarting] = useState(false);
  if (!work.onRequest || work.state === "running") return null;
  if (work.kind === "triage") {
    return <p className="mt-1 text-ui-xs text-muted-foreground">Per avviare subito il triage di una issue aprila dall'elenco delle issue.</p>;
  }
  const blocked = work.onRequest.allowed ? null : work.onRequest.reason;
  return (
    <>
      {blocked ? (
        <p className="mt-1 text-ui-xs text-muted-foreground">
          Non si avvia ora. <ReferenceText text={blocked} />
        </p>
      ) : null}
      <div className="cta-row mt-1.5">
        <Button
          size="sm"
          data-testid="automatic-work-start"
          disabled={Boolean(blocked) || starting}
          onClick={() => {
            setStarting(true);
            void act("automaticWork:start", { kind: "architectureReview" }).finally(() => setStarting(false));
          }}
        >
          <IconPlayerPlay stroke={1.8} /> Avvia ora la revisione
        </Button>
      </div>
    </>
  );
}

function AutomaticWorkRow({ work, withRole }: { work: AutomaticWorkStatus; withRole: boolean }) {
  const state = AUTOMATIC_WORK_STATE[work.state];
  return (
    <div data-testid="automatic-work" data-work={work.kind} data-state={work.state} className="py-1.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-ui text-foreground">
          {AUTOMATIC_WORK_LABEL[work.kind]}
          {withRole ? (
            <span className="text-muted-foreground">
              <Sep />
              {roleProfile(work.role).name}
            </span>
          ) : null}
        </span>
        <Badge tone={state.tone}>{state.label}</Badge>
      </div>
      <p className="mt-0.5 text-ui-sm text-muted-foreground">{work.detail}</p>
      <StartNow work={work} />
    </div>
  );
}

/**
 * Where the fixed roles' automatic work stands (issue #231): at work, about to start, waiting and why, or idle and
 * what starts it; with the CTA that starts a review now. With `role`, only that role's work.
 */
export function AutomaticWorkSection({ role }: { role?: TeamRole }) {
  const all = useUi((s) => s.app?.project?.automaticWork);
  const works = (all ?? []).filter((w) => !role || w.role === role);
  if (!works.length) return null;
  return (
    <InspectorSection title="Lavoro automatico">
      <div className="flex flex-col divide-y divide-[color:var(--app-surface-divider)]">
        {works.map((work) => (
          <AutomaticWorkRow key={work.kind} work={work} withRole={!role} />
        ))}
      </div>
    </InspectorSection>
  );
}

/** The CTA that starts the triage of an open issue now, beside the issue's other actions. */
export function useTriageOnRequest(): { allowed: boolean; reason: string | null; running: boolean } | null {
  const triage = useUi((s) => s.app?.project?.automaticWork?.find((w) => w.kind === "triage"));
  if (!triage?.onRequest) return null;
  return {
    allowed: triage.onRequest.allowed,
    reason: triage.onRequest.allowed ? null : triage.onRequest.reason,
    running: triage.state === "running",
  };
}
