import type { NextStepView } from "@shared/domain";
import { act, useUi } from "./store";

/** Scrolls the card of a record into view; false when this dialog does not show it. */
export function revealCard(id: string): boolean {
  const card = document.querySelector(`[data-anchors~="${CSS.escape(id)}"]`);
  card?.scrollIntoView({ behavior: "smooth", block: "start" });
  return card !== null;
}

/**
 * Takes a next step (W01): the pull request opens, a step that is a message reaches the Coordinator, and every other
 * step brings its card or its panel into view. `requestId` is the request that declared the step; null when the move
 * was not declared, so it is never sent as a message. A step never does nothing (W12).
 */
export function runNextStep(step: NextStepView, requestId: string | null): void {
  const { setInspector } = useUi.getState();
  if (step.url) return void act("shell:openExternal", { url: step.url });
  // A step that is a message: Trama sends it and records that the person took it (W04).
  if (step.message && requestId) return void act("coordinator:takeStep", { requestId });
  if (step.move === "reviewCandidate" && step.targetId) return setInspector({ kind: "candidate", id: step.targetId });
  // What waits for the person is answered in Aspetta te (issue #240): a person's step opens its item there.
  const { app } = useUi.getState();
  const project = app?.project;
  if (project && step.actor === "person" && step.targetId) {
    const item = (project.waiting ?? []).find((i) => i.targetId === step.targetId);
    if (item) return setInspector({ kind: "waiting", key: item.key });
  }
  if (step.targetId && revealCard(step.targetId)) return;
  // A card this dialog does not show still has a panel that lists it.
  if (step.move === "grantMandate") setInspector({ kind: "mandate" });
  else if (step.move === "confirmTeam") setInspector({ kind: "team" });
  else if (step.move === "answerQuestions") setInspector({ kind: "pact" });
  // Seams, slices and plan review act on the plan card (M04, M05): the work panel lists the plans.
  else if (step.move === "reviewPlan" || step.move === "confirmSeams" || step.move === "confirmSlices") setInspector({ kind: "work" });
}
