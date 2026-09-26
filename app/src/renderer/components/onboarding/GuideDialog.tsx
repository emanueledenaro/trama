import { useEffect, useMemo, useState } from "react";
import { type GuideStepId, guideSteps, resumeStep, type StepState } from "@shared/onboarding";
import { TramaMark } from "@/components/brand/TramaMark";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/Spinner";
import { act, useUi } from "@/lib/store";
import { StepRow } from "./StepRow";

type SetupReport = { pathsCreated: string[]; existingPreserved: string[]; warnings: string[]; version: string };

function StepActions({ step }: { step: StepState }) {
  const app = useUi((s) => s.app)!;
  const setDialog = useUi((s) => s.setDialog);
  const setExercise = useUi((s) => s.setExercise);
  const [report, setReport] = useState<SetupReport | null>(null);
  const [running, setRunning] = useState(false);
  const id = step.id as GuideStepId;
  const skipped = step.status === "skipped";
  const skip =
    step.status === "done" ? null : skipped ? (
      <Button variant="ghost" size="xs" onClick={() => void act("onboarding:update", { unskipStep: id })}>
        Riprendi questo passo
      </Button>
    ) : (
      <Button variant="ghost" size="xs" onClick={() => void act("onboarding:update", { skipStep: id })}>
        {step.optional ? "Rimanda" : "Salta questo passo"}
      </Button>
    );

  switch (id) {
    case "provider":
      return (
        <>
          {app.codex.account?.kind === "signedOut" ? (
            <Button size="xs" onClick={() => void act("codex:login", undefined)}>
              Accedi con ChatGPT
            </Button>
          ) : null}
          <Button
            variant="outline"
            size="xs"
            onClick={() => {
              void act("codex:refresh", undefined);
              void act("providers:refresh", {});
            }}
          >
            Verifica
          </Button>
          <Button variant="outline" size="xs" onClick={() => {
              setDialog(null);
              useUi.getState().openSettings("connections");
            }}>
            Tutti i provider
          </Button>
          {skip}
        </>
      );
    case "github":
      return (
        <>
          {step.status !== "done" ? (
            <span className="w-full text-ui-xs text-muted-foreground">
              {app.gitHubCli.status === "missing" ? "Installa GitHub CLI, poi nel terminale: " : "Nel terminale: "}
              <code className="font-mono">gh auth login</code>. Puoi rimandare: l'esempio e i progetti locali restano disponibili.
            </span>
          ) : null}
          <Button variant="outline" size="xs" disabled={app.gitHubCli.status === "checking"} onClick={() => void act("onboarding:checkGitHub", undefined)}>
            Verifica
          </Button>
          {skip}
        </>
      );
    case "project":
      return (
        <>
          <Button size="xs" onClick={() => void act("project:openDialog", undefined)}>
            Apri un progetto
          </Button>
          <Button variant="outline" size="xs" onClick={() => setDialog("createProject", "guide")}>
            Crea un progetto
          </Button>
          {skip}
        </>
      );
    case "aiHero": {
      const project = app.project && !app.project.isDemo ? app.project : null;
      return (
        <>
          {project && step.status !== "done" ? (
            <Button
              size="xs"
              disabled={running}
              onClick={async () => {
                setRunning(true);
                setReport((await act("skills:prepare", undefined)) ?? null);
                setRunning(false);
              }}
            >
              {running ? <Spinner /> : null} Prepara il metodo in {project.name}
            </Button>
          ) : null}
          {skip}
          {report ? (
            <span className="w-full text-ui-xs text-muted-foreground">
              AI Hero {report.version}: {report.pathsCreated.length} percorsi creati, {report.existingPreserved.length} preservati.
              {report.warnings.length ? ` ${report.warnings.join(" ")}` : ""}
            </span>
          ) : null}
        </>
      );
    }
    case "exercise":
      return (
        <>
          <Button
            size="xs"
            onClick={() =>
              void act("exercise:start", { exercise: "first" }).then(() => {
                setExercise("first");
                setDialog(null);
              })
            }
          >
            {step.status === "done" ? "Altri esercizi" : app.project?.isDemo ? "Riprendi l'esercizio" : "Inizia il primo esercizio"}
          </Button>
          {skip}
        </>
      );
  }
}

/** The first-run guide (C12): optional, resumable, every step with its real state. */
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
