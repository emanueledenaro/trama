import { describe, expect, it } from "vitest";
import type { Candidate, CoordinatorRequest, ProjectDocument, RequestStep, SliceView, WorkPlan } from "@shared/domain";
import { asksForRecap, recapTitle } from "@shared/recap";
import { emptyDocument } from "./document";
import { createMandateRequest } from "./pact";
import { markTold, MAX_DONE, milestones, newMilestones, writeRecap } from "./recap";
import { NOTHING_GOING_ON } from "./statusLine";
import { translator } from "@shared/i18n";

const t = translator("it");

const at = (minute: number) => new Date(Date.UTC(2026, 8, 28, 10, minute)).toISOString();

function request(document: ProjectDocument, id: string, minute: number, options: { step?: RequestStep; state?: CoordinatorRequest["state"] } = {}) {
  const value: CoordinatorRequest = {
    id,
    text: id,
    moduleId: null,
    state: options.state ?? "completed",
    model: "gpt-6-luna",
    effort: "medium",
    createdAt: at(minute),
    completedAt: options.state === "running" ? null : at(minute + 1),
    failure: null,
    goalId: null,
    ...(options.step ? { step: options.step } : {}),
  };
  document.requests.push(value);
  return value;
}

/** An automatic move of the Coordinator, with the line the chat keeps for Activity. */
function move(document: ProjectDocument, id: string, minute: number, label: string, state: CoordinatorRequest["state"] = "completed") {
  request(document, id, minute, { step: { move: "assignWork", by: "trama", trigger: "round" }, state });
  document.events.push({
    id: `e-${id}`,
    sequence: document.events.length + 1,
    origin: "trama",
    requestId: id,
    createdAt: at(minute),
    content: { type: "card", kind: "automaticStep", title: label, detail: null, referenceId: id },
  });
}

/** An approved breakdown in two slices; S1 published as issue #41 by the Coordinator at `issueMinute`. */
function slicedPlan(document: ProjectDocument, issueMinute = 2): WorkPlan {
  const plan: WorkPlan = {
    id: "P-1",
    requestId: null,
    orderedBy: "coordinator",
    kind: "agreedTicket",
    moduleIds: [],
    summary: "Revisione",
    issueNumber: null,
    status: "ready",
    proposal: null,
    failure: null,
    decisionRequestIds: [],
    createdAt: at(0),
    updatedAt: at(0),
    slicing: {
      status: "approved",
      tickets: [
        { id: "S1", title: "Stato della revisione", whatToBuild: "", acceptanceCriteria: [], blockedBy: [], issue: { number: 41, url: "https://github.com/o/r/issues/41", at: at(issueMinute) } },
        { id: "S2", title: "Avviso al cliente", whatToBuild: "", acceptanceCriteria: [], blockedBy: ["S1"], issue: null },
      ],
      feedback: null,
      approvedAt: at(0),
      failure: null,
      publishFailure: null,
    },
  };
  document.plans.push(plan);
  return plan;
}

const views = (states: Record<string, SliceView["state"]>): Record<string, SliceView[]> => ({
  "P-1": Object.entries(states).map(([id, state]) => ({ id, state, waitingFor: [], assignmentId: null })),
});

function merge(document: ProjectDocument, id: string, number: number) {
  document.candidates.push({ id, pullRequest: { url: `https://github.com/o/r/pull/${number}`, number, branch: "b", at: at(5), mergedAt: at(6) } } as Candidate);
}

function recap(document: ProjectDocument, minute: number, reason: "milestone" | "request", sliceViews: Record<string, SliceView[]> = {}) {
  const untold = newMilestones(document, sliceViews);
  return writeRecap(document, { id: `R-${minute}`, at: at(minute), reason, milestones: untold, runningRequestId: null, sources: { sliceViews } });
}

describe("asking for a recap", () => {
  it.each(["/riepilogo", "Riepilogo", "Fammi un riepilogo", "fammi il riepilogo, per favore", "Mi fai un riepilogo?", "A che punto siamo?", "Coordinatore, a che punto siamo?", "Come procede il lavoro?"])(
    "recognizes %s",
    (text) => expect(asksForRecap(text)).toBe(true),
  );

  it.each([
    "Fammi un riepilogo delle scelte sul checkout e poi prepara il piano",
    "Aggiungi un riepilogo dell'ordine nella pagina di conferma",
    "/ask-trama riepilogo",
    "Come va?",
  ])("leaves %s to the Coordinator", (text) => expect(asksForRecap(text)).toBe(false));

  it("titles the card by what made it", () => {
    expect(recapTitle(t, { reason: "request", milestones: [] })).toBe("Riepilogo");
    expect(recapTitle(t, { reason: "milestone", milestones: ["a"] })).toBe("Riepilogo: un traguardo");
    expect(recapTitle(t, { reason: "milestone", milestones: ["a", "b"] })).toBe("Riepilogo: 2 traguardi");
  });
});

describe("choosing the milestones", () => {
  it("names a slice done, a candidate merged and a goal achieved", () => {
    const document = emptyDocument("p");
    slicedPlan(document);
    merge(document, "C-1", 52);
    document.goals = [{ id: "G-1", title: "Resi senza telefonate", outcome: "", examples: [], status: "achieved", origin: "person", createdAt: at(0), updatedAt: at(7), decisionIds: [] }];
    expect(milestones(document, views({ S1: "done", S2: "working" }))).toEqual([
      { key: "slice:P-1:S1", kind: "sliceDone", text: "Fetta 1 fatta: Stato della revisione (#41)" },
      { key: "merged:C-1", kind: "candidateMerged", text: "Candidato unito con la pull request #52" },
      { key: "goal:G-1", kind: "goalAchieved", text: "Obiettivo raggiunto: Resi senza telefonate" },
    ]);
  });

  it("takes note of what a project already reached the first time, without telling it", () => {
    const document = emptyDocument("p");
    slicedPlan(document);
    expect(newMilestones(document, views({ S1: "done" }))).toEqual([]);
    expect(document.recap).toEqual({ told: ["slice:P-1:S1"], recaps: [] });
    expect(newMilestones(document, views({ S1: "done", S2: "ready" }))).toEqual([]);
    expect(newMilestones(document, views({ S1: "done", S2: "done" })).map((m) => m.key)).toEqual(["slice:P-1:S2"]);
  });

  it("does not make earlier milestones news when the first recap is one the person asked for", () => {
    const document = emptyDocument("p");
    slicedPlan(document);
    const reached = views({ S1: "done", S2: "ready" });
    expect(recap(document, 5, "request", reached).milestones).toEqual([]);
    expect(newMilestones(document, reached)).toEqual([]);
  });

  it("tells a milestone once, in one recap, also when it arrives with other events", () => {
    const document = emptyDocument("p");
    slicedPlan(document);
    markTold(document, []);
    // The slice is done and its candidate merged in the same change: one recap with both.
    merge(document, "C-1", 52);
    const reached = views({ S1: "done", S2: "ready" });
    expect(newMilestones(document, reached).map((m) => m.key)).toEqual(["slice:P-1:S1", "merged:C-1"]);
    const written = recap(document, 10, "milestone", reached);
    expect(written.milestones).toEqual(["Fetta 1 fatta: Stato della revisione (#41)", "Candidato unito con la pull request #52"]);
    expect(document.recap?.recaps).toHaveLength(1);
    // Later events find nothing new: no second recap for the same milestone.
    expect(newMilestones(document, reached)).toEqual([]);
    expect(newMilestones(document, views({ S1: "done", S2: "done" })).map((m) => m.key)).toEqual(["slice:P-1:S2"]);
  });

  it("does not take a slice in verification or a pull request still open as a milestone", () => {
    const document = emptyDocument("p");
    slicedPlan(document);
    document.candidates.push({ id: "C-2", pullRequest: { url: "u", number: 53, branch: "b", at: at(5), mergedAt: null } } as Candidate);
    expect(milestones(document, views({ S1: "verifying", S2: "blocked" }))).toEqual([]);
  });
});

describe("the content of a recap", () => {
  it("cites the moves since the last recap and the issues the Coordinator opened, with their number", () => {
    const document = emptyDocument("p");
    move(document, "m1", 1, "Assegna il lavoro");
    slicedPlan(document, 3);
    const first = recap(document, 4, "request");
    expect(first.done).toEqual([
      { text: "Assegnazione del lavoro fatta", number: null, url: null },
      { text: "Aperta la issue #41 della fetta 1: Stato della revisione", number: 41, url: "https://github.com/o/r/issues/41" },
    ]);
    move(document, "m2", 6, "Verifica il candidato");
    move(document, "m3", 8, "Prepara il piano", "running");
    const second = recap(document, 9, "request");
    // Only what came after the first recap; the move still running is what the Coordinator does, not what it did.
    expect(second.done).toEqual([{ text: "Verifica del candidato fatta", number: null, url: null }]);
  });

  it("gives the reason of a move not made without repeating the outcome", () => {
    const document = emptyDocument("p");
    move(document, "m1", 1, "Esegui le verifiche");
    document.requests[0]!.step!.stalled = "La mossa automatica non è riuscita: l'incarico A-1 è concluso ma il suo candidato non è stato dichiarato.";
    expect(recap(document, 2, "request").done).toEqual([
      { text: "Verifica del lavoro non riuscita. L'incarico A-1 è concluso ma il suo candidato non è stato dichiarato.", number: null, url: null },
    ]);
  });

  it("says when nothing happened since the last recap", () => {
    const document = emptyDocument("p");
    recap(document, 1, "request");
    expect(recap(document, 2, "request").done).toEqual([]);
  });

  it("keeps every issue and sends the older moves to Activity when there are many", () => {
    const document = emptyDocument("p");
    for (let minute = 0; minute < MAX_DONE + 3; minute += 1) move(document, `m${minute}`, minute, `Mossa ${minute}`);
    slicedPlan(document, 30);
    const done = recap(document, 40, "request").done;
    expect(done.some((fact) => fact.number === 41)).toBe(true);
    expect(done.at(-1)?.text).toBe("Altre 4 mosse sono in Attività");
    expect(done.filter((fact) => fact.text.startsWith("Mossa"))).toHaveLength(MAX_DONE - 1);
    expect(done.at(-3)?.text).toBe(`Mossa ${MAX_DONE + 2}: fatta`);
  });

  it("lists what waits for the person with a reference to each item, and nothing when nothing waits", () => {
    const document = emptyDocument("p");
    const empty = recap(document, 1, "request");
    expect(empty.needs).toEqual([]);
    expect(empty.doing).toBe(NOTHING_GOING_ON);
    const mandate = createMandateRequest(document, { requestId: null, reason: "Serve il mandato per lavorare sugli ordini.", objectives: ["Ordini"], priorities: [], scopeModuleIds: ["Sources/Orders"], authorizedActions: ["plan"], limits: [] });
    const asked = recap(document, 2, "request");
    expect(asked.needs).toEqual([{ key: `mandate:${mandate.id}`, label: "Mandato", title: "Serve il mandato per lavorare sugli ordini." }]);
    expect(asked.milestones).toEqual([]);
  });
});
