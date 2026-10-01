import { IconCircleCheck, IconX } from "@/components/icons";
import { useMemo, useState } from "react";
import { EXERCISE_IDS, type ExerciseId, exerciseDescriptor, exerciseSteps, hasUsableProvider, resumeStep } from "@shared/onboarding";
import { Button, FilledScope } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { useWaiting } from "@/components/WaitingView";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";
import { act, useUi } from "@/lib/store";
import { StepRow } from "./StepRow";
import { Sep } from "@/components/ui/sep";
import { useT } from "@/lib/i18n";

const DECISION_PROMPT =
  "Esercizio: fammi una domanda di prodotto sul caso dell'ordine pagato annullato, con alternative concrete, usando request_decision. Non modificare nulla.";

/** The exercises talk in the project dialog: show it, so the message and the reply appear where the person looks (W12). */
function send(text: string) {
  useUi.getState().openDialog(null);
  void act("coordinator:send", { text, moduleId: null, model: null, effort: null, goalId: null });
}

/** Actions for the step the exercise waits for. They never mark a step: the state does. */
function CurrentActions({ exercise, step }: { exercise: ExerciseId; step: string | null }) {
  const t = useT();
  const setInspector = useUi((s) => s.setInspector);
  const running = useUi((s) => s.app?.project?.runningRequestId ?? null);
  const [simulating, setSimulating] = useState(false);
  const descriptor = exerciseDescriptor(t, exercise);
  if (!step) return null;
  const prompt = (label: string, text: string) => (
    <>
      <p className="w-full rounded-md bg-[var(--color-background-button-secondary)] px-2 py-2 text-ui-xs text-muted-foreground">{text}</p>
      <Button disabled={!!running} onClick={() => send(text)}>
        {label}
      </Button>
    </>
  );
  if (exercise === "first") {
    switch (step) {
      case "read":
        return (
          <Button
            onClick={() => {
              // The study card lives in the project dialog: show that dialog first, then the card.
              useUi.getState().openDialog(null);
              requestAnimationFrame(() => document.querySelector('[data-anchor="study"]')?.scrollIntoView({ behavior: "smooth", block: "start" }));
              void act("exercise:observe", { step: "studyRead" });
            }}
          >
            {t("exercise.showStudy")}
          </Button>
        );
      case "ask":
        return prompt(t("exercise.sendQuestion"), descriptor.prompt!);
      case "map":
        return (
          <Button onClick={() => setInspector({ kind: "map" })}>
            {t("exercise.openMap")}
          </Button>
        );
      case "module":
        return (
          <Button variant="outline" onClick={() => setInspector({ kind: "map" })}>
            {t("exercise.chooseModule")}
          </Button>
        );
      case "decision":
        return prompt(t("exercise.askDecision"), DECISION_PROMPT);
      default:
        return null;
    }
  }
  if (exercise === "conflict") {
    return step === "candidate" ? null : (
      <Button
        disabled={simulating}
        onClick={async () => {
          setSimulating(true);
          await act("exercise:simulateRemoteChanges", undefined);
          setSimulating(false);
        }}
      >
        {simulating ? <Spinner /> : null} {t("exercise.simulate")}
      </Button>
    );
  }
  return descriptor.prompt ? prompt(t("exercise.sendRequest"), descriptor.prompt) : null;
}

/** The exercise guide over the example project's chat (C13, C14). It can be closed and recalled. */
export function ExercisePanel() {
  const t = useT();
  const exercise = useUi((s) => s.exercise);
  const setExercise = useUi((s) => s.setExercise);
  const app = useUi((s) => s.app)!;
  const project = app.project;
  const waiting = useWaiting().length > 0;
  const steps = useMemo(
    () => (exercise && project?.isDemo ? exerciseSteps(t, exercise, project.document, { providerReady: hasUsableProvider(app) }) : []),
    [exercise, project, app, t.language],
  );
  if (!exercise || !project?.isDemo) return null;
  const descriptor = exerciseDescriptor(t, exercise);
  const current = resumeStep(steps);
  const completed = app.onboarding.completedExercises;

  return (
    // The window's one filled button is Aspetta te's while something waits: the steps' primaries are outlines then.
    <FilledScope allowed={!waiting}>
      <aside
        aria-label={t("exercise.panel")}
        // Never wider than the conversation less its margins, and it ends above the composer's dock (--chat-dock, ChatView).
        className="no-drag absolute top-14 right-3 z-20 flex max-h-[calc(100%-var(--chat-dock,8rem)-4.5rem)] w-[min(20rem,calc(100%-1.5rem))] flex-col overflow-hidden rounded-xl border border-[color:var(--color-border)] bg-popover text-popover-foreground shadow-lg"
      >
        <div className="flex items-center gap-2 pt-2 pr-2 pl-4">
          <span className="min-w-0 flex-1 truncate text-ui-xs text-muted-foreground">{t("exercise.panel")}<Sep />{t("exercise.localCopy")}</span>
          <IconButton label={t("exercise.close")} icon={<IconX />} size="icon" onClick={() => setExercise(null)} />
        </div>
        <div className="flex gap-2 px-4 pt-2" role="tablist" aria-label={t("exercise.tabs")}>
          {EXERCISE_IDS.map((id) => exerciseDescriptor(t, id)).map((e, index) => (
            <button
              key={e.id}
              type="button"
              role="tab"
              aria-selected={e.id === exercise}
              title={e.title}
              onClick={() => void act("exercise:start", { exercise: e.id }).then(() => setExercise(e.id))}
              className={cn(
                "inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md px-2 text-ui-xs transition-colors",
                e.id === exercise
                  ? "bg-[var(--color-background-button-secondary)] text-foreground"
                  : "text-muted-foreground hover:bg-[var(--color-background-button-secondary-hover)]",
              )}
            >
              {completed[e.id] ? <IconCircleCheck className="size-3 text-success" stroke={2} /> : null}
              {index + 1}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          <h3 className="px-2 pt-2 text-ui font-medium text-foreground">{descriptor.title}</h3>
          <p className="px-2 pt-1 text-ui-sm text-muted-foreground">{descriptor.intro}</p>
          <ol className="mt-2 space-y-0.5" aria-label={t("exercise.steps")}>
            {steps.map((step, index) => (
              <StepRow key={step.id} step={step} index={index} current={step.id === current} expanded={step.id === current}>
                {step.id === current ? <CurrentActions exercise={exercise} step={current} /> : null}
              </StepRow>
            ))}
          </ol>
          {completed[exercise] || !current ? (
            <div className="mx-2 mt-4 rounded-lg border border-[color:var(--color-border)] px-2 py-2">
              <p className="text-ui-sm text-foreground/90">{t("exercise.completed")}</p>
              <div className="cta-row mt-2">
                <Button variant="outline" onClick={() => useUi.getState().setDialog("createProject")}>
                  {t("welcome.start.create")}
                </Button>
                <Button onClick={() => void act("project:openDialog", undefined)}>
                  {t("exercise.openMine")}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </aside>
    </FilledScope>
  );
}
