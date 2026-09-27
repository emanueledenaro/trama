import { describe, expect, it } from "vitest";
import type { DecisionRequest, MandateRequest, ProjectDocument, SliceTicket, SliceView, Specialist, TeamProposal, WorkPlan } from "./domain";
import { emptyDocument } from "../main/core/document";
import { blocksText, sortWaiting, type WaitingItem, waitingForYou, waitingItemFor, waitingSummary } from "./waitingForYou";

function withRequests(...ids: [string, string | null][]): ProjectDocument {
  const document = emptyDocument("p");
  for (const [id, goalId] of ids) {
    document.requests.push({ id, text: id, moduleId: null, state: "completed", model: null, effort: null, createdAt: "", completedAt: null, failure: null, goalId });
  }
  return document;
}

function question(id: string, requestId: string | null, askedAt: string, extra: Partial<DecisionRequest> = {}): DecisionRequest {
  return {
    id,
    requestId,
    category: "product",
    question: `Domanda ${id}`,
    concreteCase: "Ordine 42",
    alternatives: [],
    revisesDecisionId: null,
    askedAt,
    outcome: null,
    ...extra,
  };
}

function mandateRequest(id: string, requestId: string | null, askedAt: string, resolution: MandateRequest["resolution"] = null): MandateRequest {
  return { id, requestId, reason: `Richiesta ${id}`, objectives: [], priorities: [], scopeModuleIds: [], authorizedActions: [], limits: [], askedAt, resolution };
}

function ticket(id: string, blockedBy: string[] = []): SliceTicket {
  return { id, title: id, whatToBuild: id, acceptanceCriteria: [], blockedBy, issue: null };
}

function plan(id: string, requestId: string, extra: Partial<WorkPlan> = {}): WorkPlan {
  return {
    id,
    requestId,
    orderedBy: "person",
    kind: "newFeature",
    moduleIds: [],
    summary: `Piano ${id}`,
    issueNumber: null,
    status: "ready",
    proposal: null,
    failure: null,
    decisionRequestIds: [],
    createdAt: "2026-09-01T10:00:00Z",
    updatedAt: "2026-09-01T10:00:00Z",
    ...extra,
  };
}

const approved = (tickets: SliceTicket[]): WorkPlan["slicing"] => ({
  status: "approved",
  tickets,
  feedback: null,
  approvedAt: "2026-09-01T10:00:00Z",
  failure: null,
  publishFailure: null,
});

const view = (id: string, state: SliceView["state"]): SliceView => ({ id, state, waitingFor: [], assignmentId: null });

describe("Aspetta te (issue #240)", () => {
  it("gathers open questions, the pending mandate, the team proposal, plans to review and memory proposals", () => {
    const document = withRequests(["R1", null], ["R2", "G1"]);
    document.decisionRequests.push(
      question("D1", "R1", "2026-09-01T10:00:00Z"),
      question("D2", "R1", "2026-09-01T10:01:00Z", { outcome: { answer: "a", alternativeIndex: 0, decisionId: "PD1", version: 1, answeredAt: "" } }),
      question("D3", "R1", "2026-09-01T10:02:00Z", { withdrawal: { reason: "non serve", withdrawnAt: "" } }),
      question("D4", "R2", "2026-09-01T10:03:00Z", { goalId: "G1", grilling: { subjectRequestId: "R2", round: 1, number: 1, recommendedIndex: 0 } }),
    );
    document.mandateRequests.push(mandateRequest("M1", "R1", "2026-09-01T09:00:00Z"));
    const proposal: TeamProposal = { id: "T1", requestId: "R1", summary: null, members: [{ name: "Ada", competence: "Ordini", reason: "", moduleIds: [] }], askedAt: "2026-09-01T09:30:00Z", resolution: null };
    document.team.proposals.push(proposal);
    document.plans.push(plan("P1", "R1", { status: "seams" }));

    const items = waitingForYou(document, {
      memoryProposals: [{ id: "L1", target: "user", summary: "Togli una nota ripetuta", createdAt: "2026-09-01T08:00:00Z" }],
    });

    expect(items.map((i) => i.key).sort()).toEqual(["mandate:M1", "memory:L1", "question:D1", "question:D4", "seams:P1", "team:T1"]);
    const grilling = items.find((i) => i.key === "question:D4")!;
    expect(grilling).toMatchObject({ label: "Chiarimento", goalId: "G1", title: "Domanda D4" });
    expect(items.find((i) => i.kind === "team")!.title).toBe("Conferma gli sviluppatori proposti: Ada.");
    // A memory proposal holds no work: it comes after everything that does.
    expect(items.at(-1)).toMatchObject({ key: "memory:L1", blocks: 0 });
  });

  it("never lists a superseded mandate request (W14), only the latest one still waiting", () => {
    const document = withRequests(["R1", null]);
    document.mandateRequests.push(
      mandateRequest("M1", "R1", "2026-09-01T09:00:00Z", { kind: "superseded", version: null, resolvedAt: "", supersededBy: "M2" }),
      mandateRequest("M2", "R1", "2026-09-01T09:05:00Z"),
    );
    expect(waitingForYou(document).map((i) => i.key)).toEqual(["mandate:M2"]);
    document.mandateRequests[1]!.resolution = { kind: "granted", version: 1, resolvedAt: "" };
    expect(waitingForYou(document)).toEqual([]);
  });

  it("counts the slices a developer's question holds: its own and every slice that waits for it", () => {
    const document = withRequests(["R1", null]);
    document.plans.push(plan("P1", "R1", { slicing: approved([ticket("S1"), ticket("S2", ["S1"]), ticket("S3", ["S2"]), ticket("S4")]) }));
    const developer = {
      id: "SP1",
      assignments: [{ id: "A1", slice: { planId: "P1", sliceId: "S1" } }],
    } as unknown as Specialist;
    document.team.specialists.push(developer);
    document.decisionRequests.push(question("D1", "R1", "2026-09-01T10:00:00Z", { blocksWork: { assignmentId: "A1", questionId: "Q1" } }));

    const [item] = waitingForYou(document, { sliceViews: { P1: [view("S1", "paused"), view("S2", "blocked"), view("S3", "blocked"), view("S4", "working")] } });
    expect(item).toMatchObject({ label: "Domanda di uno sviluppatore", blocks: 3 });
  });

  it("orders by the work each item holds, then from the oldest", () => {
    // Three dialogs, so each question belongs to its own work.
    const document = withRequests(["R1", null], ["R2", "G2"], ["R3", "G3"]);
    document.plans.push(plan("P1", "R1", { slicing: approved([ticket("S1"), ticket("S2", ["S1"]), ticket("S3", ["S1"])]) }));
    document.decisionRequests.push(
      question("D1", "R1", "2026-09-01T10:00:00Z"),
      question("D2", "R2", "2026-09-01T09:00:00Z"),
      question("D3", "R3", "2026-09-01T08:00:00Z"),
    );
    const items = waitingForYou(document, { sliceViews: { P1: [view("S1", "ready"), view("S2", "blocked"), view("S3", "blocked")] } });
    // D1 holds the three slices of its plan; D2 and D3 hold their work alone, so the older D3 comes first.
    expect(items.map((i) => [i.targetId, i.blocks])).toEqual([
      ["D1", 3],
      ["D3", 1],
      ["D2", 1],
    ]);
  });

  it("lets a missing mandate hold every slice not started in the project", () => {
    const document = withRequests(["R1", null], ["R2", null]);
    document.plans.push(plan("P1", "R1", { slicing: approved([ticket("S1"), ticket("S2")]) }), plan("P2", "R2", { slicing: approved([ticket("S1")]) }));
    document.mandateRequests.push(mandateRequest("M1", "R2", "2026-09-01T09:00:00Z"));
    const sliceViews = { P1: [view("S1", "done"), view("S2", "ready")], P2: [view("S1", "ready")] };
    expect(waitingForYou(document, { sliceViews })[0]).toMatchObject({ kind: "mandate", label: "Mandato", blocks: 2 });
  });

  it("lists a breakdown to confirm with the number of its slices", () => {
    const document = withRequests(["R1", null]);
    document.plans.push(plan("P1", "R1", { slicing: { ...approved([ticket("S1"), ticket("S2")])!, status: "proposed" } }));
    expect(waitingForYou(document)).toEqual([
      expect.objectContaining({ key: "slices:P1", label: "Fette del piano", title: "Piano P1", blocks: 2 }),
    ]);
  });

  it("sorts without changing the list it receives", () => {
    const base = { kind: "question", targetId: "x", label: "", title: "", goalId: null } as const;
    const items: WaitingItem[] = [
      { ...base, key: "a", askedAt: "2026-09-01T10:00:00Z", blocks: 0 },
      { ...base, key: "b", askedAt: "2026-09-01T11:00:00Z", blocks: 2 },
    ];
    expect(sortWaiting(items).map((i) => i.key)).toEqual(["b", "a"]);
    expect(items.map((i) => i.key)).toEqual(["a", "b"]);
  });

  it("says in plain words how many things wait and how much each one holds", () => {
    expect(waitingSummary(0)).toBeNull();
    expect(waitingSummary(1)).toBe("1 cosa aspetta te");
    expect(waitingSummary(2)).toBe("2 cose aspettano te");
    expect(blocksText(0)).toBe("Non ferma il lavoro");
    expect(blocksText(1)).toBe("Ferma 1 parte del lavoro");
    expect(blocksText(4)).toBe("Ferma 4 parti del lavoro");
  });

  it("finds the item a chat card stands for, and none once the card is answered", () => {
    const document = withRequests(["R1", null]);
    document.decisionRequests.push(question("D1", "R1", "2026-09-01T10:00:00Z"));
    document.plans.push(plan("P1", "R1", { status: "seams" }));
    const items = waitingForYou(document);
    expect(waitingItemFor(items, "question", "D1")?.key).toBe("question:D1");
    expect(waitingItemFor(items, "plan", "P1")?.key).toBe("seams:P1");
    expect(waitingItemFor(items, "mandate", "D1")).toBeNull();
    document.decisionRequests[0]!.outcome = { answer: "a", alternativeIndex: 0, decisionId: "PD1", version: 1, answeredAt: "" };
    expect(waitingItemFor(waitingForYou(document), "question", "D1")).toBeNull();
  });
});
