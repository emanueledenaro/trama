import { useState } from "react";
import { IconRefresh, IconSettings } from "@/components/icons";
import type { GuideStepId, StepState } from "@shared/onboarding";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Spinner } from "@/components/Spinner";
import { useT, withNodes } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";

type SetupReport = { pathsCreated: string[]; existingPreserved: string[]; warnings: string[]; version: string };

/**
 * The actions of one step of Configura, in the Benvenuto (B02, issue #354): what the person does to take the step,
 * and "Rimanda" or "Riprendi questo passo". Calls to action sit on the right with the primary last. They never mark a
 * step done: the state does.
 */
export function StepActions({ step }: { step: StepState }) {
  const t = useT();
  const app = useUi((s) => s.app)!;
  const [report, setReport] = useState<SetupReport | null>(null);
  const [running, setRunning] = useState(false);
  const id = step.id as GuideStepId;
  const size = "xs";
  const skipped = step.status === "skipped";
  const skip =
    step.status === "done" ? null : skipped ? (
      <Button variant="ghost" size={size} onClick={() => void act("onboarding:update", { unskipStep: id })}>
        {t("step.resumeThis")}
      </Button>
    ) : (
      <Button variant="ghost" size={size} onClick={() => void act("onboarding:update", { skipStep: id })}>
        {step.optional ? t("step.postpone") : t("step.skipThis")}
      </Button>
    );
  const note = (text: React.ReactNode) => <span className="w-full text-ui-xs text-muted-foreground">{text}</span>;

  switch (id) {
    case "provider":
      return (
        <>
          {skip}
          <IconButton label={t("step.allProviders")} icon={<IconSettings />} size="icon" onClick={() => useUi.getState().openSettings("connections")} />
          <IconButton
            label={t("step.checkAgain")}
            icon={<IconRefresh />}
            size="icon"
            onClick={() => {
              void act("codex:refresh", undefined);
              void act("providers:refresh", {});
            }}
          />
          {app.codex.account?.kind === "signedOut" ? (
            <Button size={size} onClick={() => void act("codex:login", undefined)}>
              {t("step.signInChatGpt")}
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
                  {withNodes(t(app.gitHubCli.status === "missing" ? "step.github.missing" : "step.github.signIn"), {
                    command: <code className="font-mono">gh auth login</code>,
                  })}
                </>,
              )
            : null}
          {skip}
          <IconButton
            label={t("step.checkAgain")}
            icon={<IconRefresh />}
            size="icon"
            disabled={app.gitHubCli.status === "checking"}
            onClick={() => void act("onboarding:checkGitHub", undefined)}
          />
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
              {t("step.dontPrepare")}
            </Button>
            <Button variant={choice?.prepare ? "subtle" : "default"} size={size} onClick={() => void act("onboarding:update", { methodChoice: true })}>
              {t("step.prepareMethod")}
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
              {running ? <Spinner /> : null} {t("step.prepareMethodIn", { name: project.name })}
            </Button>
          ) : null}
          {report
            ? note(
                <>
                  {t("method.report", { version: report.version, created: report.pathsCreated.length, preserved: report.existingPreserved.length })}
                  {report.warnings.length ? ` ${report.warnings.join(" ")}` : ""}
                </>,
              )
            : null}
        </>
      );
    }
    default:
      return null;
  }
}
