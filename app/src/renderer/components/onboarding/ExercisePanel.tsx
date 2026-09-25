import { IconCircleCheck, IconX } from "@tabler/icons-react";
import { useMemo, useState } from "react";
import { EXERCISES, type ExerciseId, exerciseDescriptor, exerciseSteps, hasUsableProvider, resumeStep } from "@shared/onboarding";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/Spinner";
import { cn } from "@/lib/cn";
import { act, useUi } from "@/lib/store";
import { StepRow } from "./StepRow";
import { Sep } from "@/components/ui/sep";

const DECISION_PROMPT =
  "Esercizio: fammi una domanda di prodotto sul caso dell'ordine pagato annullato, con alternative concrete, usando request_decision. Non modificare nulla.";

/** The exercises talk in the project dialog: show it, so the message and the reply appear where the person looks (W12). */
function send(text: string) {
  useUi.getState().openDialog(null);
  void act("coordinator:send", { text, moduleId: null, model: null, effort: null, goalId: null });
}

/** Actions for the step the exercise waits for. They never mark a step: the state does. */
function CurrentActions({ exercise, step }: { exercise: ExerciseId; step: string | null }) {
  const setInspector = useUi((s) => s.setInspector);
  const running = useUi((s) => s.app?.project?.runningRequestId ?? null);
  const [simulating, setSimulating] = useState(false);
  const descriptor = exerciseDescriptor(exercise);
  if (!step) return null;
  const prompt = (label: string, text: string) => (
    <>
      <p className="w-full rounded-md bg-[var(--color-background-button-secondary)] px-2 py-1.5 text-ui-xs text-muted-foreground">{text}</p>
      <Button size="xs" disabled={!!running} onClick={() => send(text)}>
        {label}
      </Button>
    </>
  );
  if (exercise === "first") {
    switch (step) {
      case "read":
        return (
          <Button
            size="xs"
            onClick={() => {
              // The study card lives in the project dialog: show that dialog first, then the card.
              useUi.getState().openDialog(null);
              requestAnimationFrame(() => document.querySelector('[data-anchor="study"]')?.scrollIntoView({ behavior: "smooth", block: "start" }));
              void act("exercise:observe", { step: "studyRead" });
            }}
          >
            Mostra la scheda di studio
          </Button>
        );
      case "ask":
        return prompt("Invia la domanda", descriptor.prompt!);
      case "map":
        return (
          <Button size="xs" onClick={() => setInspector({ kind: "map" })}>
            Apri la mappa
          </Button>
        );
      case "module":
        return (
          <Button size="xs" variant="outline" onClick={() => setInspector({ kind: "map" })}>
            Scegli un modulo nella mappa
          </Button>
        );
      case "decision":
        return prompt("Chiedi una decisione", DECISION_PROMPT);
      default:
        return null;
    }
  }
  if (exercise === "conflict") {
    return step === "candidate" ? null : (
      <Button
        size="xs"
        disabled={simulating}
        onClick={async () => {
          setSimulating(true);
          await act("exercise:simulateRemoteChanges", undefined);
          setSimulating(false);
        }}
      >
        {simulating ? <Spinner /> : null} Crea le modifiche simulate
      </Button>
    );
  }
  return descriptor.prompt ? prompt("Invia la richiesta al Coordinatore", descriptor.prompt) : null;
}

/** The exercise guide over the example project's chat (C13, C14). It can be closed and recalled. */
export function ExercisePanel() {
  const exercise = useUi((s) => s.exercise);
  const setExercise = useUi((s) => s.setExercise);
  const app = useUi((s) => s.app)!;
  const project = app.project;
  const steps = useMemo(
    () => (exercise && project?.isDemo ? exerciseSteps(exercise, project.document, { providerReady: hasUsableProvider(app) }) : []),
    [exercise, project, app],
  );
  if (!exercise || !project?.isDemo) return null;
  const descriptor = exerciseDescriptor(exercise);
  const current = resumeStep(steps);
  const completed = app.onboarding.completedExercises;

  return (
    <aside
      aria-label="Esercizio"
      className="no-drag absolute top-[54px] right-3 z-20 flex max-h-[calc(100%-170px)] w-[320px] flex-col overflow-hidden rounded-xl border border-[color:var(--color-border)] bg-popover text-popover-foreground shadow-lg"
    >
      <div className="flex items-center gap-2 px-3.5 pt-3">
        <span className="min-w-0 flex-1 truncate text-ui-xs text-muted-foreground">Esercizio<Sep />copia locale di esempio</span>
        <button type="button" className="sidebar-icon-button size-5 rounded-md" aria-label="Chiudi l'esercizio" onClick={() => setExercise(null)}>
          <IconX className="size-3.5" />
        </button>
      </div>
      <div className="flex gap-1 px-3 pt-2" role="tablist" aria-label="Esercizi">
        {EXERCISES.map((e, index) => (
          <button
            key={e.id}
            type="button"
            role="tab"
            aria-selected={e.id === exercise}
            title={e.title}
            onClick={() => void act("exercise:start", { exercise: e.id }).then(() => setExercise(e.id))}
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded-md px-2 text-ui-xs transition-colors",
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
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <h3 className="px-1.5 pt-2 text-ui font-medium text-foreground">{descriptor.title}</h3>
        <p className="px-1.5 pt-1 text-ui-sm text-muted-foreground">{descriptor.intro}</p>
        <ol className="mt-2 space-y-0.5" aria-label="Passi dell'esercizio">
          {steps.map((step, index) => (
            <StepRow key={step.id} step={step} index={index} current={step.id === current} expanded={step.id === current}>
              {step.id === current ? <CurrentActions exercise={exercise} step={current} /> : null}
            </StepRow>
          ))}
        </ol>
        {completed[exercise] || !current ? (
          <div className="mt-3 rounded-lg border border-[color:var(--color-border)] px-2.5 py-2">
            <p className="text-ui-sm text-foreground/90">Esercizio completato.</p>
            <div className="cta-row mt-1.5">
              <Button size="xs" onClick={() => void act("project:openDialog", undefined)}>
                Apri il mio progetto
              </Button>
              <Button size="xs" variant="outline" onClick={() => useUi.getState().setDialog("createProject")}>
                Crea un progetto
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
