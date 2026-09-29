import { randomUUID } from "node:crypto";
import type { AutonomousMove, AutonomousStep, DelegableMove, MandateAction, ProjectDocument, WorkPlan } from "@shared/domain";
import { AUTONOMOUS_STEP_LABELS } from "@shared/activity";
import { shortId } from "@shared/ids";
import type { ContinuationGuards } from "./continuousWork";
import { focusView } from "./focus";
import { DomainError } from "./pact";
import type { MessageKey } from "@shared/i18n";
import { t } from "./personLanguage";
import { authorize, isTeamConfirmed } from "./team";
import { workRequests, workState } from "./workPhase";

/**
 * The whole cycle within the mandate (A06, Q1): the person's steps that only confirm the Coordinator's own work (the
 * shared understanding, the team, the seams of the spec and the slices) are taken by the Coordinator when the mandate
 * covers them. Trama takes them from the records, never from what a model says, records them as the Coordinator's and
 * tells them in Activity and in the recap. The person corrects any of them in their own words and the work starts again
 * from that step. Product decisions and the mandate stay with the person; the merge follows the green light (issue #247),
 * and a candidate that changes the interface waits for the person's ok.
 */

/** The action of the mandate each step needs: the understanding, the seams and the slices are planning; the team is composing it. */
export const STEP_ACTIONS: Record<DelegableMove, MandateAction> = {
  confirmUnderstanding: "plan",
  confirmSeams: "plan",
  confirmSlices: "plan",
  confirmTeam: "composeTeam",
};

/** The steps as Activity and the recap name them. */
export const STEP_LABELS = AUTONOMOUS_STEP_LABELS;

/** A step the Coordinator can take now: which, in which dialog, on which record, and the modules it touches. */
export interface DelegatedStep {
  move: DelegableMove;
  requestId: string | null;
  goalId: string | null;
  targetId: string | null;
}

const DELEGABLE: DelegableMove[] = ["confirmUnderstanding", "confirmTeam", "confirmSeams", "confirmSlices"];

const isDelegable = (move: string): move is DelegableMove => (DELEGABLE as string[]).includes(move);

/**
 * Whether the mandate covers the step: granted, with the step's action, and every module the step touches in its scope.
 * Without a mandate, or outside its perimeter, the step stays with the person (A06).
 */
export function mandateCovers(document: ProjectDocument, move: DelegableMove, moduleIds: string[]): boolean {
  return authorize(document.mandate, STEP_ACTIONS[move], moduleIds) === "authorized";
}

/** The modules a step touches: the plan's for the seams and the slices, the proposed developers' for the team. */
function stepModules(document: ProjectDocument, move: DelegableMove, targetId: string | null): string[] {
  if (move === "confirmTeam") {
    const proposal = document.team.proposals.find((p) => p.id === targetId);
    return [...new Set((proposal?.members ?? []).flatMap((m) => m.moduleIds))];
  }
  // The plan's modules, as prepare_plan authorized them: assign_task checks each assignment's own modules later.
  return document.plans.find((p) => p.id === targetId)?.moduleIds ?? [];
}

/**
 * Whether the person corrected this step and the correction has not had its turn yet: until a request of the dialog
 * starts after the correction, the Coordinator does not take the same step again.
 */
function correctionPending(document: ProjectDocument, move: DelegableMove, targetId: string | null, dialog: string | null): boolean {
  const corrected = (document.autonomousSteps ?? [])
    .filter((s) => s.move === move && s.correction && (s.targetId === targetId || (move === "confirmUnderstanding" && s.requestId === dialog)))
    .map((s) => s.correction!.at);
  if (!corrected.length) return false;
  const latest = corrected.reduce((a, b) => (a > b ? a : b));
  const goalId = dialog ? (document.requests.find((r) => r.id === dialog)?.goalId ?? null) : null;
  const after = document.requests.some((r) => (r.goalId ?? null) === goalId && r.createdAt > latest && r.state === "completed");
  return !after;
}

/** The latest request of each open dialog: the task in focus first, then the queue; paused tasks and proposed goals stay out. */
function openDialogs(document: ProjectDocument): string[] {
  const view = focusView(document);
  const tasks = [view.focus, ...view.queue.filter((t) => t.status === "queued")].filter((t) => t !== null);
  const latest: string[] = [];
  for (const task of tasks) {
    const request = document.requests.findLast((r) => (r.goalId ?? null) === (task.goalId ?? null));
    if (request && !latest.includes(request.id)) latest.push(request.id);
  }
  return latest;
}

/**
 * The person's steps the Coordinator takes now within the mandate, in order: the team first, since the work needs it,
 * then one step for each open dialog whose latest turn ended well. Pure. Nothing in pause, with continuous work off,
 * while a turn runs or a message waits, or when the step is outside the mandate.
 */
export function delegatedSteps(document: ProjectDocument, guards: ContinuationGuards): DelegatedStep[] {
  if (!guards.enabled || guards.paused || guards.busy || guards.unavailable) return [];
  if (document.mandate?.status !== "granted") return [];
  const steps: DelegatedStep[] = [];
  const proposal = isTeamConfirmed(document) ? null : document.team.proposals.find((p) => !p.resolution);
  if (proposal && mandateCovers(document, "confirmTeam", stepModules(document, "confirmTeam", proposal.id)) && !correctionPending(document, "confirmTeam", proposal.id, null)) {
    steps.push({ move: "confirmTeam", requestId: null, goalId: null, targetId: proposal.id });
  }
  for (const requestId of openDialogs(document)) {
    const latest = document.requests.find((r) => r.id === requestId)!;
    // After an error or an interruption the person decides how to go on, as for the Coordinator's moves (W04).
    if (latest.state !== "completed") continue;
    const state = workState(document, requestId);
    // A product question of the person holds the work: the Coordinator does not confirm around it.
    if (state.moves.some((m) => m.actor === "person" && m.move === "answerQuestions" && !state.questionsHoldOnlyTheirWork)) continue;
    const option = state.moves.find((m) => m.actor === "person" && isDelegable(m.move) && m.move !== "confirmTeam");
    if (!option || !isDelegable(option.move)) continue;
    const move = option.move;
    const targetId = option.targetId;
    if (!mandateCovers(document, move, stepModules(document, move, targetId))) continue;
    if (correctionPending(document, move, targetId, requestId)) continue;
    steps.push({ move, requestId, goalId: latest.goalId ?? null, targetId });
  }
  return steps;
}

/** Records a step the Coordinator took, for Activity, the recap and the person's correction. */
export function recordAutonomousStep(document: ProjectDocument, step: DelegatedStep, summary: string, now = new Date()): AutonomousStep {
  const record: AutonomousStep = {
    id: shortId("AS", randomUUID()),
    move: step.move,
    requestId: step.requestId,
    goalId: step.goalId,
    targetId: step.targetId,
    summary: summary.trim().slice(0, 500),
    at: now.toISOString(),
    correction: null,
  };
  document.autonomousSteps = [...(document.autonomousSteps ?? []), record];
  return record;
}

/**
 * The person corrects a step the Coordinator took (A06): the correction is recorded, and the confirmation no longer
 * counts. The caller starts the work again from that step. A step is corrected once; a later correction goes to the
 * Coordinator in the chat.
 */
export function correctAutonomousStep(document: ProjectDocument, stepId: string, note: string, now = new Date()): AutonomousStep {
  const step = document.autonomousSteps?.find((s) => s.id === stepId);
  if (!step) throw new DomainError(t("main.autonomousCycle.stepNotFound"));
  if (step.correction) throw new DomainError(t("main.autonomousCycle.alreadyCorrected"));
  const text = note.trim();
  if (!text) throw new DomainError(t("main.autonomousCycle.emptyCorrection"));
  step.correction = { note: text.slice(0, 2000), at: now.toISOString() };
  return step;
}

/**
 * Whether the work after a plan's seams or slices already started: an assignment of the plan's work made after it. Then
 * a correction cannot redraw the plan under the developers' feet, and goes to the Coordinator instead.
 */
export function planWorkStarted(document: ProjectDocument, plan: WorkPlan): boolean {
  const scope = plan.requestId ? workRequests(document, plan.requestId) : null;
  return document.team.specialists.some((s) =>
    s.assignments.some((a) => a.slice?.planId === plan.id || (a.requestId !== null && scope?.has(a.requestId) === true && a.createdAt >= plan.createdAt)),
  );
}

/**
 * What the Coordinator reads when the person corrects one of its steps and the work cannot simply be redrawn. Trama
 * sends it as the person's message, so the chat shows it in the person's language.
 */
export function correctionMessage(step: AutonomousStep): string {
  const what: Record<AutonomousMove, MessageKey> = {
    confirmUnderstanding: "main.autonomousCycle.what.confirmUnderstanding",
    confirmTeam: "main.autonomousCycle.what.confirmTeam",
    confirmSeams: "main.autonomousCycle.what.confirmSeams",
    confirmSlices: "main.autonomousCycle.what.confirmSlices",
    formSquads: "main.autonomousCycle.what.formSquads",
  };
  return t("main.autonomousCycle.correction", { what: t(what[step.move]), note: step.correction?.note ?? "" });
}

/** The Coordinator's line in the turn's state (A06): which steps Trama takes on its behalf, and where new work goes. @model-text */
export function autonomyLine(document: ProjectDocument): string {
  const covered = DELEGABLE.filter((move) => authorize(document.mandate, STEP_ACTIONS[move]) === "authorized");
  const steps = covered.length
    ? `Dentro il mandato Trama conferma per te ${covered.map((m) => STEP_LABELS[m].replace(/ dal Coordinatore$/, "").toLowerCase()).join(", ")}, e risolvi da solo verifiche rosse, conflitti e incarichi fermi: non chiedere questi passi alla persona.`
    : "Senza un mandato che li copra, comprensione, team, seam e fette restano della persona.";
  // Issue #247: the merge follows the green light by Trama's rule; the Coordinator never asks for it in the chat.
  const merge =
    authorize(document.mandate, "integrateCandidate") === "authorized"
      ? " Con il tuo via libera (clear_candidate) e il cancello dei revisori superato Trama pubblica e unisce il candidato da solo; un candidato che cambia l'interfaccia aspetta l'ok della persona in Aspetta te, con le schermate: non chiedere l'unione in chat."
      : "";
  return `${steps}${merge} Il lavoro nuovo, fuori dagli obiettivi aperti, lo proponi con propose_goal e non lo assegni: un obiettivo proposto non riceve incarichi finché la persona non lo conferma.`;
}
