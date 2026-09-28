import type { SpecialistAssignment } from "@shared/domain";
import { dutyOutcomeText, dutyTriggerText } from "@shared/duties";
import { useT, withNodes } from "@/lib/i18n";
import { useUi } from "@/lib/store";
import { ReferenceText } from "./ReferenceText";

/** Why Trama started a fixed role's work, by itself or on request (issue #231), the AI Hero skill it runs and the outcome (W11). */
export function DutyFields({ assignment }: { assignment: SpecialistAssignment }) {
  const document = useUi((s) => s.app?.project?.document);
  const t = useT();
  const duty = assignment.duty;
  if (!duty || !document) return null;
  const outcome = dutyOutcomeText(duty, document);
  return (
    <div data-testid="duty-fields">
      <div className="mt-2">
        <div className="text-ui-xs text-muted-foreground/70">{duty.requestedBy ? t("chat.duty.startedOnRequest") : t("chat.duty.started")}</div>
        <div className="mt-0.5 text-ui text-foreground/90">
          <ReferenceText text={dutyTriggerText(document, duty)} />
        </div>
        <div className="mt-0.5 text-ui-sm text-muted-foreground">
          {withNodes(t("chat.duty.skill"), { skill: <span className="font-mono text-[11px]">{duty.skill}</span> })}
        </div>
      </div>
      {outcome ? (
        <div className="mt-2">
          <div className="text-ui-xs text-muted-foreground/70">{t("chat.duty.outcome")}</div>
          <div className="mt-0.5 text-ui text-foreground/90">
            <ReferenceText text={outcome} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
