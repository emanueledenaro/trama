import { describe, expect, it } from "vitest";
import type { CoordinatorRequest, ProjectDocument, WorkPlan } from "@shared/domain";
import { placeGrillingQuestion } from "@shared/grilling";
import { emptyDocument } from "./document";
import { focusTask, focusText, focusView, NOT_STARTED_LABEL, openTasks, pauseTask, resumeTask, taskIdOf, TASK_TITLE_LIMIT } from "./focus";
import { archiveGoal, createGoal, proposeGoal, updateGoal } from "./goals";
import { createDecisionRequest } from "./pact";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 25, 10, minute));

function request(document: ProjectDocument, id: string, goalId: string | null, minute: number, text = id): CoordinatorRequest {
  const value: CoordinatorRequest = {
    id,
    text,
    moduleId: null,
    state: "completed",
    model: null,
    effort: null,
    createdAt: at(minute).toISOString(),
    completedAt: null,
    failure: null,
    goalId,
  };
  document.requests.push(value);
  return value;
}

function goal(document: ProjectDocument, title: string, minute: number) {
  return createGoal(document, { title, outcome: `${title}: fatto`, examples: [] }, at(minute));
}

function plan(document: ProjectDocument, requestId: string, status: WorkPlan["status"]) {
  document.plans.push({
    id: `P-${document.plans.length + 1}`,
    requestId,
    orderedBy: "coordinator",
    kind: "agreedTicket",
    moduleIds: [],
    summary: "Piano",
    issueNumber: null,
    status,
    proposal: null,
    failure: status === "failed" ? "Il pianificatore non ha risposto." : null,
    decisionRequestIds: [],
    createdAt: at(30).toISOString(),
    updatedAt: at(30).toISOString(),
  });
}

function question(document: ProjectDocument, requestId: string) {
  const grilling = placeGrillingQuestion(document, {
    runningRequestId: requestId,
    round: 1,
    recommendedIndex: 0,
    alternatives: 2,
  });
  return createDecisionRequest(document, {
    requestId,
    category: "product",
    question: "Chi vede lo stato?",
    concreteCase: "Ordine 42",
    alternatives: [
      {
        behavior: "Solo il supporto",
        example: "Il supporto vede l'ordine 42",
        consequence: null,
      },
      {
        behavior: "Anche il cliente",
        example: "Il cliente vede lo stato review",
        consequence: null,
      },
    ],
    revisesDecisionId: null,
    grilling,
  });
}

/** Two goals and work in the project dialog: the orders goal (oldest, its plan in writing), the export goal nobody started and the dialog's work. */
function project() {
  const document = emptyDocument("p");
  const orders = goal(document, "Revisione degli ordini", 1);
  const exports = goal(document, "Esportazione CSV", 2);
  request(document, "g0", orders.id, 2);
  plan(document, "g0", "planning");
  request(document, "r1", null, 3, "Aggiungi   il login\ncon GitHub");
  question(document, "r1");
  return { document, orders, exports };
}

const ids = (document: ProjectDocument) => {
  const view = focusView(document);
  return {
    focus: view.focus?.id ?? null,
    queue: view.queue.map((t) => `${t.id}:${t.status}`),
  };
};

describe("open tasks", () => {
  it("has no focus in a project without work or goals", () => {
    const document = emptyDocument("p");
    request(document, "r1", null, 1, "Ciao");
    expect(openTasks(document)).toEqual([]);
    expect(focusView(document)).toEqual({ focus: null, queue: [] });
    expect(focusText(document, "r1")).toBeNull();
  });

  it("lists started tasks oldest first, then the ones nobody started, with phase and what the work waits for", () => {
    const { document, orders, exports } = project();
    plan(document, "r1", "planning");
    request(document, "g1", orders.id, 4);
    plan(document, "g1", "failed");
    expect(focusView(document)).toEqual({
      focus: {
        id: `goal:${orders.id}`,
        goalId: orders.id,
        title: "Revisione degli ordini",
        phase: "blocked",
        phaseLabel: "bloccata",
        blocker: "Il piano P-3 non è riuscito: Il pianificatore non ha risposto.",
        waitingFor: null,
        status: "focus",
      },
      queue: [
        {
          id: "work:r1",
          goalId: null,
          title: "Aggiungi il login con GitHub",
          phase: "spec",
          phaseLabel: "spec",
          blocker: null,
          waitingFor: "Rispondi alla domanda",
          status: "queued",
        },
        {
          id: `goal:${exports.id}`,
          goalId: exports.id,
          title: "Esportazione CSV",
          phase: null,
          phaseLabel: NOT_STARTED_LABEL,
          blocker: null,
          waitingFor: null,
          status: "queued",
        },
      ],
    });
  });

  it("shows the seams to confirm as the spec phase waiting for the person (M04)", () => {
    const { document, orders } = project();
    request(document, "g1", orders.id, 4);
    plan(document, "g1", "seams");
    expect(focusView(document).focus).toMatchObject({ id: `goal:${orders.id}`, phase: "spec", phaseLabel: "spec", blocker: null, waitingFor: "Conferma i seam" });
  });

  it("leaves out a goal the Coordinator only proposed", () => {
    const document = emptyDocument("p");
    proposeGoal(document, { title: "Proposto", outcome: "Da confermare", examples: [] }, at(1));
    expect(focusView(document)).toEqual({ focus: null, queue: [] });
  });

  it("titles the project dialog's work with its first message, shortened", () => {
    const document = emptyDocument("p");
    request(document, "r1", null, 1, "a".repeat(200));
    question(document, "r1");
    const [task] = openTasks(document);
    expect(task!.title).toHaveLength(TASK_TITLE_LIMIT);
    expect(task!.title.endsWith("…")).toBe(true);
    expect(taskIdOf(document, "r1")).toBe("work:r1");
  });
});

describe("focus and queue", () => {
  it("passes the focus to the next task when the task in focus is paused, and a resumed task goes back to the queue", () => {
    const { document, orders, exports } = project();
    expect(ids(document)).toEqual({
      focus: `goal:${orders.id}`,
      queue: ["work:r1:queued", `goal:${exports.id}:queued`],
    });
    pauseTask(document, `goal:${orders.id}`);
    expect(ids(document)).toEqual({
      focus: "work:r1",
      queue: [`goal:${exports.id}:queued`, `goal:${orders.id}:paused`],
    });
    // A task that starts later does not take the focus, even when it is older: the next task was written down at the pause.
    const older = goal(document, "Prima di tutto", 0);
    request(document, "g9", older.id, 9);
    plan(document, "g9", "planning");
    expect(openTasks(document)[0]!.id).toBe(`goal:${older.id}`);
    expect(focusView(document).focus?.id).toBe("work:r1");
    resumeTask(document, `goal:${orders.id}`);
    expect(ids(document).focus).toBe("work:r1");
    expect(ids(document).queue).toContain(`goal:${orders.id}:queued`);
    expect(() => resumeTask(document, `goal:${orders.id}`)).toThrow(/non è in pausa/);
  });

  it("puts a queued or paused task in focus", () => {
    const { document, exports } = project();
    pauseTask(document, "work:r1");
    expect(() => pauseTask(document, "work:r1")).toThrow(/già in pausa/);
    focusTask(document, "work:r1");
    expect(ids(document).focus).toBe("work:r1");
    expect(document.focus!.pausedTaskIds).toEqual([]);
    focusTask(document, `goal:${exports.id}`);
    expect(ids(document).focus).toBe(`goal:${exports.id}`);
  });

  it("passes the focus to the next task when the task in focus closes", () => {
    const { document, orders, exports } = project();
    focusTask(document, `goal:${exports.id}`);
    updateGoal(document, exports.id, { status: "achieved" });
    expect(ids(document).focus).toBe(`goal:${orders.id}`);
    archiveGoal(document, orders.id, at(40));
    expect(ids(document)).toEqual({ focus: "work:r1", queue: [] });
    expect(() => focusTask(document, `goal:${orders.id}`)).toThrow(/non è aperto/);
  });

  it("has no focus when every open task is paused", () => {
    const { document, orders, exports } = project();
    for (const id of [`goal:${orders.id}`, `goal:${exports.id}`, "work:r1"]) pauseTask(document, id);
    const view = focusView(document);
    expect(view.focus).toBeNull();
    expect(view.queue.map((t) => t.status)).toEqual(["paused", "paused", "paused"]);
    resumeTask(document, "work:r1");
    expect(focusView(document).focus?.id).toBe("work:r1");
  });
});

describe("focus for the Coordinator", () => {
  it("tells the Coordinator the focus, the queue and whether the message is about the focus", () => {
    const { document, orders, exports } = project();
    request(document, "g1", orders.id, 4);
    request(document, "g2", exports.id, 5);
    request(document, "r2", null, 6, "Che ore sono?");
    const onFocus = focusText(document, "g1")!;
    expect(onFocus).toContain(`In focus: l'obiettivo "Revisione degli ordini" (goal:${orders.id}), fase spec.`);
    expect(onFocus).toContain(`In coda: il lavoro del dialogo del progetto, l'obiettivo "Esportazione CSV".`);
    expect(onFocus).toContain("resta su questo task");
    pauseTask(document, `goal:${exports.id}`);
    expect(focusText(document, "g2")).toContain(
      'Il messaggio riguarda l\'obiettivo "Esportazione CSV", che è in pausa. Rispondi, poi riporta la conversazione sul task in focus',
    );
    // A message in the project dialog belongs to the dialog's work, which is queued.
    expect(focusText(document, "r2")).toContain("Il messaggio riguarda il lavoro del dialogo del progetto, che è in coda.");
  });

  it("brings a message outside any task back to the focus", () => {
    const document = emptyDocument("p");
    goal(document, "Revisione degli ordini", 1);
    request(document, "r1", null, 2, "Ciao");
    expect(focusText(document, "r1")).toContain(
      "Il messaggio non riguarda il task in focus. Rispondi in breve, poi riporta la conversazione sul task in focus",
    );
  });
});

describe("saved focus", () => {
  it("ignores a malformed focus record", () => {
    const { document, orders } = project();
    document.focus = {
      taskId: 42,
      pausedTaskIds: "work:r1",
    } as unknown as ProjectDocument["focus"];
    expect(focusView(document).focus?.id).toBe(`goal:${orders.id}`);
    pauseTask(document, "work:r1");
    expect(document.focus).toEqual({
      taskId: `goal:${orders.id}`,
      pausedTaskIds: ["work:r1"],
    });
  });
});
