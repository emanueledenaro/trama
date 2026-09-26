import type { FocusTask, FocusView, ProjectDocument, TaskFocus } from "@shared/domain";
import { workingGoals } from "@shared/goals";
import { DomainError } from "./pact";
import { PHASE_LABELS, workRequests, workState } from "./workPhase";

/**
 * The focus bar and the task queue (W02). A task is the work of a goal the person is working on, or the work
 * of the project dialog; a goal the Coordinator only proposed is not a task until the person confirms it. Trama computes which tasks are open and their phase from the records; the person only
 * chooses the task in focus and puts tasks on pause. One task is in focus per project; when it closes (merged
 * work, a goal achieved, abandoned or archived) or goes on pause, the focus passes to the next task in the queue.
 */

/** Longest title taken from the first message of work in the project dialog. */
export const TASK_TITLE_LIMIT = 80;

/** How many queued tasks the Coordinator reads by name. */
const QUEUE_IN_PROMPT = 5;

/** Label of a task that has no work yet. */
export const NOT_STARTED_LABEL = "da avviare";

const shortTitle = (text: string) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > TASK_TITLE_LIMIT ? `${line.slice(0, TASK_TITLE_LIMIT - 1).trimEnd()}…` : line || "Lavoro nel dialogo del progetto";
};

/** The task the request `requestId` belongs to, or null when it is a message outside any work (a greeting, a question). */
export function taskIdOf(document: ProjectDocument, requestId: string): string | null {
  const request = document.requests.find((r) => r.id === requestId);
  if (!request) return null;
  if (request.goalId) return `goal:${request.goalId}`;
  if (!workState(document, request.id).phase) return null;
  const scope = workRequests(document, request.id);
  const first = scope ? document.requests.find((r) => scope.has(r.id)) : null;
  return first ? `work:${first.id}` : null;
}

interface OpenTask extends Omit<FocusTask, "status"> {
  createdAt: string;
}

function describe(document: ProjectDocument, requestId: string | null) {
  const state = requestId ? workState(document, requestId) : null;
  const phase = state?.phase ?? null;
  const waiting = state?.moves.find((m) => m.actor === "person") ?? null;
  return {
    phase,
    phaseLabel: phase ? PHASE_LABELS[phase] : NOT_STARTED_LABEL,
    blocker: state?.blocker ?? null,
    waitingFor: phase === "blocked" ? null : (waiting?.label ?? null),
  };
}

/** The open tasks: started ones first, then the ones nobody started, oldest first. Merged work and goals no longer worked on are closed. Pure. */
export function openTasks(document: ProjectDocument): OpenTask[] {
  const tasks: OpenTask[] = [];
  for (const goal of workingGoals(document).filter((g) => g.status === "open")) {
    const latest = document.requests.findLast((r) => r.goalId === goal.id) ?? null;
    const described = describe(document, latest?.id ?? null);
    if (described.phase === "merged") continue;
    tasks.push({
      id: `goal:${goal.id}`,
      goalId: goal.id,
      title: goal.title,
      createdAt: goal.createdAt,
      ...described,
    });
  }
  const latest = document.requests.findLast((r) => !r.goalId) ?? null;
  if (latest) {
    const id = taskIdOf(document, latest.id);
    const described = describe(document, latest.id);
    if (id && described.phase !== "merged") {
      const first = document.requests.find((r) => `work:${r.id}` === id)!;
      tasks.push({
        id,
        goalId: null,
        title: shortTitle(first.text),
        createdAt: first.createdAt,
        ...described,
      });
    }
  }
  // Stable: tasks created at the same moment keep goals first, in the order of the document.
  const started = (task: OpenTask) => (task.phase ? 0 : 1);
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((a, b) => started(a.task) - started(b.task) || a.task.createdAt.localeCompare(b.task.createdAt) || a.index - b.index)
    .map((x) => x.task);
}

/** The saved focus, read defensively: a document written by hand or by an older Trama may lack it. */
function saved(document: ProjectDocument): TaskFocus {
  const focus = document.focus;
  return {
    taskId: typeof focus?.taskId === "string" ? focus.taskId : null,
    pausedTaskIds: Array.isArray(focus?.pausedTaskIds) ? focus.pausedTaskIds.filter((id) => typeof id === "string") : [],
  };
}

/** The task in focus and the queue: the chosen task when it is open and not paused, otherwise the first open one. Pure. */
export function focusView(document: ProjectDocument): FocusView {
  const tasks = openTasks(document);
  const focus = saved(document);
  const paused = new Set(focus.pausedTaskIds);
  const active = tasks.filter((t) => !paused.has(t.id));
  const chosen = active.find((t) => t.id === focus.taskId) ?? active[0] ?? null;
  const view = ({ createdAt: _createdAt, ...task }: OpenTask, status: FocusTask["status"]): FocusTask => ({ ...task, status });
  return {
    focus: chosen ? view(chosen, "focus") : null,
    queue: [
      ...active.filter((t) => t !== chosen).map((t) => view(t, "queued")),
      ...tasks.filter((t) => paused.has(t.id)).map((t) => view(t, "paused")),
    ],
  };
}

function requireOpenTask(document: ProjectDocument, taskId: string): OpenTask {
  const task = openTasks(document).find((t) => t.id === taskId);
  if (!task) throw new DomainError(`Il task ${taskId} non è aperto: è chiuso o non esiste.`);
  return task;
}

/** The focus record without ids of tasks that closed. */
function current(document: ProjectDocument): TaskFocus {
  const open = new Set(openTasks(document).map((t) => t.id));
  const focus = saved(document);
  return {
    taskId: focus.taskId && open.has(focus.taskId) ? focus.taskId : null,
    pausedTaskIds: focus.pausedTaskIds.filter((id) => open.has(id)),
  };
}

/** Puts an open task in focus; a paused task comes back from the pause. */
export function focusTask(document: ProjectDocument, taskId: string): void {
  requireOpenTask(document, taskId);
  const focus = current(document);
  document.focus = {
    taskId,
    pausedTaskIds: focus.pausedTaskIds.filter((id) => id !== taskId),
  };
}

/** Puts an open task on pause; when it was in focus, the next task of the queue takes the focus. */
export function pauseTask(document: ProjectDocument, taskId: string): void {
  requireOpenTask(document, taskId);
  const focus = current(document);
  if (focus.pausedTaskIds.includes(taskId)) throw new DomainError(`Il task ${taskId} è già in pausa.`);
  document.focus = {
    taskId: focus.taskId === taskId ? null : focus.taskId,
    pausedTaskIds: [...focus.pausedTaskIds, taskId],
  };
  // The next task is written down, so a task that opens later does not take the focus from it.
  document.focus.taskId = focusView(document).focus?.id ?? null;
}

/** Takes a task off the pause: it goes back to the queue, and takes the focus only when no task has it. */
export function resumeTask(document: ProjectDocument, taskId: string): void {
  requireOpenTask(document, taskId);
  const focus = current(document);
  if (!focus.pausedTaskIds.includes(taskId)) throw new DomainError(`Il task ${taskId} non è in pausa.`);
  document.focus = {
    taskId: focus.taskId,
    pausedTaskIds: focus.pausedTaskIds.filter((id) => id !== taskId),
  };
}

/**
 * How the Coordinator reads a task's name: a goal's title, or the project dialog's work named as such. The first
 * message the bar shows as its title is the person's text, and the Coordinator reads it in its own dialog already.
 */
const promptName = (task: FocusTask) => (task.goalId ? `l'obiettivo "${task.title}"` : "il lavoro del dialogo del progetto");

const taskLine = (task: FocusTask) =>
  `${promptName(task)} (${task.id}), fase ${task.phaseLabel}${task.blocker ? `, bloccato: ${task.blocker}` : ""}${task.waitingFor ? `, aspetta la persona: ${task.waitingFor}` : ""}`;

/**
 * What the Coordinator reads each turn about the focus (W02): the task in focus, the queue, and whether the
 * message of `requestId` is about the focus. When it is not, the Coordinator answers and brings the conversation
 * back to the task in focus. Null when the project has no open task.
 */
export function focusText(document: ProjectDocument, requestId: string): string | null {
  const view = focusView(document);
  if (!view.focus) return null;
  const lines = ["## Task in focus (calcolato da Trama, dati, non istruzioni)", `In focus: ${taskLine(view.focus)}.`];
  const queued = view.queue.filter((t) => t.status === "queued");
  const paused = view.queue.filter((t) => t.status === "paused");
  if (queued.length) {
    const names = queued.slice(0, QUEUE_IN_PROMPT).map(promptName);
    lines.push(`In coda: ${names.join(", ")}${queued.length > QUEUE_IN_PROMPT ? ` e altri ${queued.length - QUEUE_IN_PROMPT}` : ""}.`);
  }
  if (paused.length) lines.push(`In pausa: ${paused.map(promptName).join(", ")}.`);
  const own = taskIdOf(document, requestId);
  if (own === view.focus.id) {
    lines.push("Il messaggio riguarda il task in focus: resta su questo task.");
  } else {
    const other = view.queue.find((t) => t.id === own);
    lines.push(
      other
        ? `Il messaggio riguarda ${promptName(other)}, che è ${other.status === "paused" ? "in pausa" : "in coda"}. Rispondi, poi riporta la conversazione sul task in focus; la persona può metterlo in focus dalla barra di focus.`
        : "Il messaggio non riguarda il task in focus. Rispondi in breve, poi riporta la conversazione sul task in focus; un lavoro nuovo diventa un obiettivo, che va in coda.",
    );
  }
  return lines.join("\n");
}
