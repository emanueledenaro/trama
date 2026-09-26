import { useEffect, useMemo, useState } from "react";
import { guideSteps, resumeStep } from "@shared/onboarding";
import { TramaMark } from "@/components/brand/TramaMark";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { act, useUi } from "@/lib/store";
import { StepActions } from "./StepActions";
import { StepRow } from "./StepRow";

/** The first-run guide (C12): optional, resumable, every step with its real state. It reopens the welcome (B02). */
export function GuideDialog() {
  const open = useUi((s) => s.dialog === "guide");
  const setDialog = useUi((s) => s.setDialog);
  const app = useUi((s) => s.app)!;
  const steps = useMemo(() => guideSteps(app), [app]);
  const resume = resumeStep(steps);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    // Resume where the person stopped, and read gh once per session.
    setExpanded(resumeStep(guideSteps(useUi.getState().app!)) ?? "exercise");
    if (useUi.getState().app?.gitHubCli.status === "unknown") void act("onboarding:checkGitHub", undefined);
  }, [open]);

  const done = steps.filter((s) => s.status === "done").length;
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => setDialog(value ? "guide" : null)}
      title="Guida introduttiva"
      icon={<TramaMark size={36} variant="tile" />}
      description="Configura Trama e prova il metodo su una copia locale di esempio. Puoi interrompere e riprendere da Impostazioni o dal menu Aiuto."
      className="w-[min(36rem,calc(100vw-2rem))]"
      footer={
        <>
          <span className="mr-auto text-ui-xs text-muted-foreground">
            {done === 1 ? "1 passo" : `${done} passi`} su {steps.length} completati
          </span>
          {!app.onboarding.dismissedAt && resume ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void act("onboarding:update", { dismissed: true }).then(() => setDialog(null))}
            >
              Salta la guida
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setDialog(null);
              useUi.getState().setWelcome("hello");
            }}
          >
            Rivedi il benvenuto
          </Button>
          <Button variant="outline" size="sm" onClick={() => setDialog(null)}>
            {resume ? "Continua più tardi" : "Chiudi"}
          </Button>
        </>
      }
    >
      <ol className="mt-1 space-y-0.5" aria-label="Passi della guida">
        {steps.map((step, index) => (
          <StepRow
            key={step.id}
            step={step}
            index={index}
            current={step.id === resume}
            expanded={expanded === step.id}
            onToggle={() => setExpanded(expanded === step.id ? null : step.id)}
          >
            <StepActions step={step} />
          </StepRow>
        ))}
      </ol>
    </Dialog>
  );
}
