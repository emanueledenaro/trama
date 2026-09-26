import { useState } from "react";
import type { GuideStepId, StepState } from "@shared/onboarding";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/Spinner";
import { act, useUi } from "@/lib/store";

type SetupReport = { pathsCreated: string[]; existingPreserved: string[]; warnings: string[]; version: string };

/**
 * The actions of one guide step, shared by the guide (C12) and the welcome (B02). Calls to action sit on the
 * right with the primary last; in the welcome the footer owns "skip", so `where="welcome"` leaves it out.
 */
export function StepActions({ step, where = "guide" }: { step: StepState; where?: "guide" | "welcome" }) {
  const app = useUi((s) => s.app)!;
  const setDialog = useUi((s) => s.setDialog);
  const setExercise = useUi((s) => s.setExercise);
  const [report, setReport] = useState<SetupReport | null>(null);
  const [running, setRunning] = useState(false);
  const id = step.id as GuideStepId;
  const size = where === "welcome" ? "sm" : "xs";
  const skipped = step.status === "skipped";
  const skip =
    where === "welcome" || step.status === "done" ? null : skipped ? (
      <Button variant="ghost" size={size} onClick={() => void act("onboarding:update", { unskipStep: id })}>
        Riprendi questo passo
      </Button>
    ) : (
      <Button variant="ghost" size={size} onClick={() => void act("onboarding:update", { skipStep: id })}>
        {step.optional ? "Rimanda" : "Salta questo passo"}
      </Button>
    );
  const note = (text: React.ReactNode) => <span className="w-full text-ui-xs text-muted-foreground">{text}</span>;

  switch (id) {
    case "provider":
      return (
        <>
          {skip}
          {where === "guide" ? (
            <Button
              variant="outline"
              size={size}
              onClick={() => {
                setDialog(null);
                useUi.getState().openSettings("connections");
              }}
            >
              Tutti i provider
            </Button>
          ) : null}
          <Button
            variant="outline"
            size={size}
            onClick={() => {
              void act("codex:refresh", undefined);
              void act("providers:refresh", {});
            }}
          >
            Controlla di nuovo
          </Button>
          {app.codex.account?.kind === "signedOut" ? (
            <Button size={size} onClick={() => void act("codex:login", undefined)}>
              Accedi con ChatGPT
            </Button>
          ) : null}
        </>
      );
    case "github":
      return (
        <>
          {step.status !== "done"
            ? note(
                <>
                  {app.gitHubCli.status === "missing" ? "Installa GitHub CLI, poi nel terminale: " : "Nel terminale: "}
                  <code className="font-mono">gh auth login</code>. Puoi rimandare: l'esempio e i progetti locali restano disponibili.
                </>,
              )
            : null}
          {skip}
          <Button variant="outline" size={size} disabled={app.gitHubCli.status === "checking"} onClick={() => void act("onboarding:checkGitHub", undefined)}>
            Controlla di nuovo
          </Button>
        </>
      );
    case "project":
      return (
        <>
          {skip}
          <Button variant="outline" size={size} onClick={() => setDialog("createProject", "guide")}>
            Crea un progetto
          </Button>
          <Button size={size} onClick={() => void act("project:openDialog", undefined)}>
            Apri un progetto
          </Button>
        </>
      );
    case "aiHero": {
      const project = app.project && !app.project.isDemo ? app.project : null;
      if (!project) {
        // Before any project is open, the step is the answer: prepare the method in the projects that open.
        const choice = app.onboarding.methodChoice;
        return (
          <>
            {skip}
            <Button variant={choice?.prepare === false ? "subtle" : "outline"} size={size} onClick={() => void act("onboarding:update", { methodChoice: false })}>
              Non preparare
            </Button>
            <Button variant={choice?.prepare ? "subtle" : "default"} size={size} onClick={() => void act("onboarding:update", { methodChoice: true })}>
              Prepara il metodo
            </Button>
          </>
        );
      }
      return (
        <>
          {skip}
          {step.status !== "done" ? (
            <Button
              size={size}
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
          {report
            ? note(
                <>
                  AI Hero {report.version}: {report.pathsCreated.length} percorsi creati, {report.existingPreserved.length} preservati.
                  {report.warnings.length ? ` ${report.warnings.join(" ")}` : ""}
                </>,
              )
            : null}
        </>
      );
    }
    case "exercise":
      return (
        <>
          {skip}
          <Button
            size={size}
            onClick={() =>
              void act("exercise:start", { exercise: "first" }).then(() => {
                setExercise("first");
                setDialog(null);
              })
            }
          >
            {step.status === "done" ? "Altri esercizi" : app.project?.isDemo ? "Riprendi l'esercizio" : "Inizia il primo esercizio"}
          </Button>
        </>
      );
  }
}
