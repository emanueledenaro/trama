import { describe, expect, it } from "vitest";
import type { Candidate, CandidateReport, DecisionRequest, MandateRequest, ProjectDocument, ProjectGoal, SliceTicket, SliceView, Specialist, TeamProposal, WorkPlan } from "./domain";
import type { AskTramaRoute } from "./askTrama";
import { emptyConsent } from "./presence";
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

  describe("every card that waits for the person (issue #292)", () => {
    const goal = (id: string, status: ProjectGoal["status"], createdAt: string, extra: Partial<ProjectGoal> = {}): ProjectGoal => ({
      id,
      title: `Obiettivo ${id}`,
      outcome: "",
      examples: [],
      status,
      origin: "coordinator",
      createdAt,
      updatedAt: createdAt,
      decisionIds: [],
      ...extra,
    });
    const route = (id: string, requestId: string, status: AskTramaRoute["status"]): AskTramaRoute => ({
      id,
      requestId,
      goalId: null,
      situation: `Situazione ${id}`,
      path: "mainFlow",
      steps: [],
      boundary: "continue",
      reason: "",
      status,
      createdAt: "2026-09-01T07:00:00Z",
      answeredAt: null,
    });
    const candidate = (id: string, extra: Partial<Candidate> = {}) =>
      ({ id, assignmentId: "A1", goalId: null, updatedAt: "2026-09-01T06:00:00Z", humanApproval: null, pullRequest: null, ...extra }) as unknown as Candidate;
    const report = (state: CandidateReport["state"], approvalInvalidated = false): CandidateReport => ({ state, blockers: [], clearanceInvalidated: false, approvalInvalidated });

    it("lists proposed goals, the pending presence proposal, proposed routes and candidates to look at", () => {
      const document = withRequests(["R1", null]);
      document.goals = [goal("G1", "proposed", "2026-09-01T05:00:00Z"), goal("G2", "open", "2026-09-01T05:00:00Z"), goal("G3", "proposed", "2026-09-01T05:00:00Z", { archivedAt: "2026-09-02T00:00:00Z" })];
      document.presence = { ...emptyConsent(), pending: "initial", proposedAt: "2026-09-01T04:00:00Z" };
      document.routes = [route("AT-1", "R1", "proposed"), route("AT-2", "R1", "declined")];
      document.team.specialists.push({ id: "SP1", assignments: [{ id: "A1", objective: "Aggiungi il filtro per data" }] } as unknown as Specialist);
      document.candidates.push(
        candidate("C1"),
        candidate("C2", { humanApproval: { actor: "persona", fingerprint: "x", at: "" } }),
        candidate("C3", { humanApproval: { actor: "persona", fingerprint: "x", at: "" } }),
        candidate("C4"),
        candidate("C5", { pullRequest: { url: "", number: 1, branch: "b", at: "" } }),
      );
      const items = waitingForYou(document, {
        candidateReports: { C1: report("verified"), C2: report("decided"), C3: report("verified", true), C4: report("building"), C5: report("verified") },
      });

      expect(items.map((i) => i.key).sort()).toEqual(["candidate:C1", "candidate:C3", "goal:G1", "presence:initial", "route:AT-1"]);
      expect(items.find((i) => i.kind === "goal")).toMatchObject({ label: "Obiettivo proposto", title: "Obiettivo G1", blocks: 0 });
      expect(items.find((i) => i.kind === "presence")).toMatchObject({ label: "Presenza", askedAt: "2026-09-01T04:00:00Z", blocks: 0 });
      expect(items.find((i) => i.key === "candidate:C1")).toMatchObject({ label: "Candidato da guardare", title: "Aggiungi il filtro per data", blocks: 1 });
      expect(items.find((i) => i.kind === "route")).toMatchObject({ label: "Percorso di Ask Trama", title: "Situazione AT-1", blocks: 1 });
    });

    it("leaves to Trama the candidates it merges with the green light and waits for the person on the interface ones (issue #247)", () => {
      const document = withRequests(["R1", null]);
      document.team.specialists.push({ id: "SP1", assignments: [{ id: "A1", objective: "Colore del pulsante Paga" }] } as unknown as Specialist);
      document.candidates.push(
        candidate("C1"),
        candidate("C2"),
        candidate("C3"),
        candidate("C4", { humanRejection: { actor: "Persona", note: "Illeggibile in scuro", fingerprint: "x", at: "" } }),
      );
      const routed = (route: CandidateReport["mergeRoute"]): CandidateReport => ({ ...report("decided"), mergeRoute: route });
      const items = waitingForYou(document, {
        candidateReports: { C1: routed("coordinator"), C2: routed("interface"), C3: routed("person"), C4: routed("interface") },
      });
      expect(items.map((i) => [i.key, i.label])).toEqual([
        ["candidate:C2", "Interfaccia da guardare"],
        ["candidate:C3", "Candidato da guardare"],
      ]);
    });

    it("keeps one order for every kind: the work held first, then the oldest", () => {
      const document = withRequests(["R1", null]);
      document.goals = [goal("G1", "proposed", "2026-09-01T05:00:00Z")];
      document.presence = { ...emptyConsent(), pending: "conflict", proposedAt: "2026-09-01T01:00:00Z", reproposedAt: "2026-09-01T04:00:00Z" };
      document.decisionRequests.push(question("D1", "R1", "2026-09-01T10:00:00Z"));
      document.candidates.push(candidate("C1"));
      const items = waitingForYou(document, {
        candidateReports: { C1: report("verified") },
        memoryProposals: [{ id: "L1", target: "memory", summary: "Nota", createdAt: "2026-09-01T03:00:00Z" }],
      });
      // Candidate and question hold work, the older first; then what holds none, from the oldest.
      expect(items.map((i) => i.key)).toEqual(["candidate:C1", "question:D1", "memory:L1", "presence:conflict", "goal:G1"]);
    });

    it("drops each item once the person answers its card", () => {
      const document = withRequests(["R1", null]);
      document.goals = [goal("G1", "proposed", "2026-09-01T05:00:00Z")];
      document.presence = { ...emptyConsent(), pending: "initial", proposedAt: "2026-09-01T04:00:00Z" };
      document.routes = [route("AT-1", "R1", "proposed")];
      document.candidates.push(candidate("C1"));
      const sources = { candidateReports: { C1: report("verified") } };
      expect(waitingItemFor(waitingForYou(document, sources), "goal", "G1")?.key).toBe("goal:G1");

      document.goals[0]!.status = "open";
      document.presence.pending = null;
      document.routes[0]!.status = "started";
      document.candidates[0]!.humanApproval = { actor: "persona", fingerprint: "x", at: "" };
      expect(waitingForYou(document, sources)).toEqual([]);
    });
  });
});
