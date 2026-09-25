import type { SpecialistAssignment } from "@shared/domain";
import { dutyOutcomeText, dutyTriggerText } from "@shared/duties";
import { useUi } from "@/lib/store";

/** Why Trama started a fixed role's work by itself, the AI Hero skill it runs and the outcome (W11). */
export function DutyFields({ assignment }: { assignment: SpecialistAssignment }) {
  const document = useUi((s) => s.app?.project?.document);
  const duty = assignment.duty;
  if (!duty || !document) return null;
  const outcome = dutyOutcomeText(duty);
  return (
    <div data-testid="duty-fields">
      <div className="mt-2">
        <div className="text-ui-xs text-muted-foreground/70">Avviato da Trama</div>
        <div className="mt-0.5 text-ui text-foreground/90">{dutyTriggerText(document, duty)}</div>
        <div className="mt-0.5 text-ui-sm text-muted-foreground">
          Skill <span className="font-mono text-[11px]">{duty.skill}</span> di AI Hero, con il suo testo originale
        </div>
      </div>
      {outcome ? (
        <div className="mt-2">
          <div className="text-ui-xs text-muted-foreground/70">Esito</div>
          <div className="mt-0.5 text-ui text-foreground/90">{outcome}</div>
        </div>
      ) : null}
    </div>
  );
}
