import { ReferenceText } from "@/components/chat/ReferenceText";
import { IconBook, IconBug, IconPlayerPlay, IconSparkles, IconStethoscope } from "@/components/icons";
import { useState } from "react";
import type { AutomaticWorkStatus, TeamRole } from "@shared/domain";
import { automaticWorkLabel, automaticWorkState } from "@shared/duties";
import { roleProfile } from "@shared/roster";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/field";
import { Sep } from "@/components/ui/sep";
import { useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";
import { InspectorSection } from "./Inspector";

const ICONS: Record<AutomaticWorkStatus["kind"], React.ReactNode> = {
  triage: <IconBug className="size-3.5" stroke={1.8} />,
  diagnosis: <IconStethoscope className="size-3.5" stroke={1.8} />,
  architectureReview: <IconSparkles className="size-3.5" stroke={1.8} />,
  domainWriting: <IconBook className="size-3.5" stroke={1.8} />,
};

/** The CTA of work the person may start now, "Avvia" on the right of its row; a triage starts from its issue. */
function StartNow({ work }: { work: AutomaticWorkStatus }) {
  const t = useT();
  const [starting, setStarting] = useState(false);
  if (!work.onRequest || work.state === "running" || work.kind === "triage") return null;
  const blocked = !work.onRequest.allowed;
  return (
    <div className="cta-row shrink-0">
      <Button
        data-testid="automatic-work-start"
        aria-label={t("automaticWork.startNamed", { work: automaticWorkLabel(t, work.kind) })}
        title={t("automaticWork.startNamed", { work: automaticWorkLabel(t, work.kind) })}
        disabled={blocked || starting}
        onClick={() => {
          setStarting(true);
          void act("automaticWork:start", { kind: "architectureReview" }).finally(() => setStarting(false));
        }}
      >
        <IconPlayerPlay stroke={1.8} /> {t("automaticWork.start")}
      </Button>
    </div>
  );
}

/** One automatic work as a row (issue #333): its icon, name and state, what it does and why it waits, and Avvia on the right. */
function AutomaticWorkRow({ work, withRole }: { work: AutomaticWorkStatus; withRole: boolean }) {
  const t = useT();
  const state = automaticWorkState(t, work.state);
  const blocked = work.onRequest && !work.onRequest.allowed && work.state !== "running" ? work.onRequest.reason : null;
  return (
    <div data-testid="automatic-work" data-work={work.kind} data-state={work.state} className="flex items-start gap-2 py-2">
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-muted-foreground">{ICONS[work.kind]}</span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-ui text-foreground" title={automaticWorkLabel(t, work.kind)}>
            {automaticWorkLabel(t, work.kind)}
            {withRole ? (
              <span className="text-muted-foreground">
                <Sep />
                {roleProfile(t, work.role).name}
              </span>
            ) : null}
          </span>
          <Badge tone={state.tone}>{state.label}</Badge>
        </div>
        <p className="mt-0.5 text-ui-xs text-muted-foreground">
          <ReferenceText text={work.detail} />
        </p>
        {blocked && work.kind !== "triage" ? (
          <p className="mt-0.5 text-ui-xs text-muted-foreground">
            {t("automaticWork.notNow")} <ReferenceText text={blocked} />
          </p>
        ) : null}
        {work.onRequest && work.kind === "triage" && work.state !== "running" ? (
          <p className="mt-0.5 text-ui-xs text-muted-foreground">{t("automaticWork.triageFromIssue")}</p>
        ) : null}
      </div>
      <StartNow work={work} />
    </div>
  );
}

/**
 * Where the fixed roles' automatic work stands (issue #231): at work, about to start, waiting and why, or idle and
 * what starts it; with the CTA that starts a review now. With `role`, only that role's work.
 */
export function AutomaticWorkSection({ role }: { role?: TeamRole }) {
  const t = useT();
  const all = useUi((s) => s.app?.project?.automaticWork);
  const works = (all ?? []).filter((w) => !role || w.role === role);
  if (!works.length) return null;
  return (
    <InspectorSection title={t("automaticWork.title")}>
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
