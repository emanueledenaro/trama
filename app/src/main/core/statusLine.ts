import type { CoordinatorRequest, NextMove, ProjectDocument, SpecialistAssignment, StatusLineAction, StatusLineView } from "@shared/domain";
import { focusView } from "./focus";
import { BLOCK_LABELS, BLOCK_PHRASES, COORDINATOR_MOVES, type CoordinatorMove, type WorkState, nextStepViews, workRequests, workState } from "./workPhase";
import { isActive } from "./team";
import { type ProviderWait, providerWaitLine } from "./resumeWork";

/**
 * The Coordinator's status line (Q6): one sentence that says what the Coordinator does now and what it does next, as in
 * "Sto verificando S2, poi assegno S3". Trama computes it from the records: the turn that runs, the plan in writing, the
 * developers at work, the next move of the task in focus and its ready slices. A model's text never reaches it.
 */

/** The line when nothing is going on: no turn runs, nobody works, and the task in focus has no next move. */
export const NOTHING_GOING_ON = "Niente in corso.";

/** The sentence of a paused project (A05): what runs ends, and nothing new starts until the person resumes. */
export const PAUSED_SENTENCE = "Coordinatore in pausa: i turni in corso finiscono, poi non parte niente finché non lo riprendi.";

const isCoordinatorMove = (move: NextMove | undefined): move is CoordinatorMove => move !== undefined && move in COORDINATOR_MOVES;

const allAssignments = (document: ProjectDocument) => document.team.specialists.flatMap((s) => s.assignments);

/** A list in Italian: "S2", "S2 e S3", "S2, S3 e S4". */
function joined(items: string[]): string {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")} e ${items.at(-1)}`;
}

/** The slice an assignment delivers, or null for work outside a breakdown. */
const sliceOf = (assignment: SpecialistAssignment | undefined) => assignment?.slice?.sliceId ?? null;

/** What a Coordinator move acts on, in words: the slice to assign or to verify, or null when the move has no single target. */
function moveTarget(document: ProjectDocument, move: CoordinatorMove, state: WorkState): string | null {
  if (move === "assignWork") {
    // The ready slices, or else the ones the slices in verification unblock: "Sto verificando S2, poi assegno S3".
    const views = state.slices?.views ?? [];
    const verifying = new Set(views.filter((v) => v.state === "verifying").map((v) => v.id));
    const ready = views.filter((v) => v.state === "ready").map((v) => v.id);
    const unblocked = views.filter((v) => v.state === "blocked" && v.waitingFor.every((id) => verifying.has(id))).map((v) => v.id);
    const next = ready.length ? ready : unblocked;
    return next.length ? joined(next.slice(0, 3)) : null;
  }
  if (move === "verifyCandidate" && state.verification) {
    const assignments = allAssignments(document);
    const slices = [
      ...state.verification.undeclared.map((id) => sliceOf(assignments.find((a) => a.id === id))),
      ...state.verification.unverified.map((id) => {
        const candidate = document.candidates.find((c) => c.id === id);
        return sliceOf(assignments.find((a) => a.id === candidate?.assignmentId));
      }),
    ];
    const named = [...new Set(slices.filter((s): s is string => s !== null))];
    return named.length && named.length === slices.length ? joined(named.slice(0, 3)) : null;
  }
  return null;
}

/** The move running now, in the first person: "Sto verificando S2". */
function runningPhrase(move: CoordinatorMove, target: string | null): string {
  switch (move) {
    case "preparePlan":
      return "Sto preparando il piano";
    case "assignWork":
      return target ? `Sto assegnando ${target}` : "Sto assegnando il lavoro";
    case "verifyCandidate":
      return target ? `Sto verificando ${target}` : "Sto verificando il lavoro";
    case "answerQuestion":
      return "Sto rispondendo a uno sviluppatore";
  }
}

/** The next move, in the first person: "assegno S3". */
function nextPhrase(move: CoordinatorMove, target: string | null): string {
  switch (move) {
    case "preparePlan":
      return "preparo il piano";
    case "assignWork":
      return target ? `assegno ${target}` : "assegno il lavoro";
    case "verifyCandidate":
      return target ? `verifico ${target}` : "verifico il lavoro";
    case "answerQuestion":
      return "rispondo allo sviluppatore";
  }
}

/** The latest request of a dialog. */
const latestOf = (document: ProjectDocument, goalId: string | null) => document.requests.findLast((r) => (r.goalId ?? null) === goalId) ?? null;

/** The Coordinator's own turn that runs now, in words, and the move it makes when it is one. */
function runningTurn(document: ProjectDocument, request: CoordinatorRequest): { phrase: string; move: CoordinatorMove | null } {
  const move = request.step?.move;
  // A move that resolves a technical block says so (A06): "Sto risolvendo il conflitto".
  if (isCoordinatorMove(move) && request.step?.block) return { phrase: BLOCK_PHRASES[request.step.block.kind], move };
  if (isCoordinatorMove(move)) return { phrase: runningPhrase(move, moveTarget(document, move, workState(document, request.id))), move };
  return { phrase: "Sto rispondendo al tuo messaggio", move: null };
}

/** The plan of the work in writing or in slicing, which runs without a Coordinator turn. */
function planPhrase(document: ProjectDocument, requestId: string): string | null {
  const scope = workRequests(document, requestId);
  const plan = scope ? document.plans.filter((p) => p.requestId !== null && scope.has(p.requestId)).at(-1) : null;
  if (plan?.status === "planning") return "Sto scrivendo il piano";
  if (plan?.slicing?.status === "drafting") return "Sto dividendo il piano in fette";
  return null;
}

/** Who works now and on what: "Luca lavora su S2", "Luca e Marco lavorano su S2 e S3", "4 agenti sono al lavoro". */
function workersPhrase(document: ProjectDocument): string | null {
  const working = document.team.specialists.flatMap((specialist) =>
    specialist.status === "removed" ? [] : specialist.assignments.filter(isActive).map((assignment) => ({ name: specialist.name, slice: sliceOf(assignment) })),
  );
  if (!working.length) return null;
  const names = [...new Set(working.map((w) => w.name))];
  if (names.length > 3) return `${names.length} agenti sono al lavoro`;
  const slices = [...new Set(working.map((w) => w.slice).filter((s): s is string => s !== null))];
  const verb = names.length === 1 ? "lavora" : "lavorano";
  return slices.length && slices.length === working.length ? `${joined(names)} ${verb} su ${joined(slices)}` : `${joined(names)} ${verb}`;
}

/**
 * Why an approved breakdown does not move: the slices that wait for others, in words. Called only when nobody works
 * and the Coordinator has no move of its own; null when a slice can start.
 */
function slicesHeld(state: WorkState): string | null {
  const views = state.slices?.views ?? [];
  if (!views.length || views.some((v) => v.state === "ready" || v.state === "working")) return null;
  const blocked = views.filter((v) => v.state === "blocked");
  if (!blocked.length) return null;
  const waitedFor = [...new Set(blocked.flatMap((v) => v.waitingFor))];
  const which = blocked.map((v) => v.id);
  return `${which.length === 1 ? `La fetta ${which[0]} aspetta` : `Le fette ${joined(which.slice(0, 4))}${which.length > 4 ? " e altre" : ""} aspettano`} ${joined(waitedFor)}.`;
}

/**
 * The status line of the project. Pure: `runningRequestId` is the Coordinator turn that runs now, if any, and `wait` the
 * provider limit the Coordinator waits for (issue #249). The next move and the person's button come from the task in
 * focus; what runs now comes from the whole project.
 */
export function statusLine(document: ProjectDocument, runningRequestId: string | null, wait: ProviderWait | null = null, at = new Date()): StatusLineView {
  const running = runningRequestId ? (document.requests.find((r) => r.id === runningRequestId && r.state === "running") ?? null) : null;
  const focus = focusView(document).focus;
  const latest = focus ? latestOf(document, focus.goalId) : null;
  const state = latest ? workState(document, latest.id) : null;

  const turn = running ? runningTurn(document, running) : null;
  const plan = latest && !turn ? planPhrase(document, latest.id) : null;
  const now = turn?.phrase ?? plan;
  const workers = workersPhrase(document);

  // The next move of the task in focus: the person's first, since the work waits for it; else the Coordinator's own.
  const personMove = state?.moves.find((m) => m.actor === "person") ?? null;
  const coordinatorMove = state?.moves.find((m) => m.actor === "coordinator" && m.move !== turn?.move) ?? null;
  const next = personMove
    ? "aspetto te"
    : coordinatorMove && isCoordinatorMove(coordinatorMove.move)
      ? nextPhrase(coordinatorMove.move, moveTarget(document, coordinatorMove.move, state!))
      : null;

  // The button: the step the Coordinator declared (or Trama's stalled move) while nothing runs in the dialog, else the person's move.
  const busyHere = running !== null && latest !== null && (running.goalId ?? null) === (latest.goalId ?? null);
  const declared = latest && !busyHere ? (nextStepViews(document)[latest.id] ?? null) : null;
  const goalId = focus?.goalId ?? null;
  const action: StatusLineAction | null = declared
    ? { ...declared, requestId: latest!.id, goalId }
    : personMove
      ? { ...personMove, reason: "", message: null, requestId: null, goalId }
      : null;

  const stalled = !busyHere && latest?.step?.by === "trama" && latest.step.stalled ? latest.step.stalled : null;
  const blocked = state?.phase === "blocked";
  const held = state && !workers && !now && !coordinatorMove ? slicesHeld(state) : null;
  const reason = blocked ? (state!.why ?? state!.blocker) : (stalled ?? held);

  const runningMove = running?.step?.by === "trama" && isCoordinatorMove(running.step.move)
    ? { requestId: running.id, label: running.step.block ? BLOCK_LABELS[running.step.block.kind] : COORDINATOR_MOVES[running.step.move].label }
    : null;

  // In pause nothing automatic starts (A05): the line says what still ends and how the work goes on again.
  if (document.continuousWork?.paused === true) {
    const paused = [now ? `${now}.` : null, workers ? `${workers}.` : null, PAUSED_SENTENCE].filter((s): s is string => s !== null);
    return { state: now || workers ? "working" : "waiting", text: paused.join(" "), reason, action, runningMove, paused: true, providerWait: null };
  }

  // A provider limit holds moves, rounds and new turns (issue #249): the line says what it waits for and until when.
  if (wait && !running) {
    const line = providerWaitLine(wait, at);
    return {
      state: workers ? "working" : "blocked",
      text: [line.text, workers ? `${workers}.` : null].filter((s): s is string => s !== null).join(" "),
      reason: line.reason,
      action: null,
      runningMove: null,
      paused: false,
      providerWait: { provider: wait.provider, until: wait.until },
    };
  }

  const sentences: string[] = [];
  if (now) sentences.push(`${now}${next ? `, poi ${next}` : ""}.`);
  if (workers) sentences.push(`${workers}.`);
  if (!now && next) sentences.push(personMove ? "Aspetto te per andare avanti." : `Il prossimo passo è mio: ${next}.`);
  if (!sentences.length && blocked) sentences.push("Il lavoro è fermo.");

  const lineState: StatusLineView["state"] =
    now || workers ? "working" : blocked || held ? "blocked" : personMove || stalled ? "waiting" : next ? "next" : action ? "waiting" : "idle";
  return {
    state: lineState,
    text: sentences.length ? sentences.join(" ") : NOTHING_GOING_ON,
    reason,
    action,
    runningMove,
    paused: false,
    providerWait: null,
  };
}
