import { describe, expect, it } from "vitest";
import type { PlanSlicing, ProjectDocument, SliceTicket, WorkPlan } from "@shared/domain";
import type { PresenceView } from "@shared/presence";
import type { RepositoryModule } from "@shared/repository";
import { declareCandidate, recordEvidence, recordTechnicalReview } from "./candidates";
import { emptyDocument } from "./document";
import { answerDecisionRequest, createDecisionRequest, grantMandate } from "./pact";
import { DEFAULT_SLICE_CHECKS, type PickInput, type PickOutcome, pickSlices, sliceModules } from "./slicePicking";
import { sliceViews } from "./slices";
import { activeDevelopers, confirmTeam, endTurn, findAssignment, proposeTeam } from "./team";

const at = (minute: number) => new Date(Date.UTC(2026, 8, 26, 10, minute));

const module = (id: string, name: string): RepositoryModule => ({ id, name, summary: "", relativePath: id, files: [], dependencies: [], symbol: "" });
const MODULES = [module("Sources/Orders", "Orders"), module("Sources/Payments", "Payments"), module("Sources/Support", "Support"), module("Sources/Mail", "Mail")];

const ticket = (number: number, blockedBy: number[] = [], text = `Comportamento ${number}`): SliceTicket => ({
  id: `S${number}`,
  title: `Fetta ${number}`,
  whatToBuild: text,
  acceptanceCriteria: [`Criterio ${number}`],
  blockedBy: blockedBy.map((n) => `S${n}`),
  issue: null,
});

const TICKETS = [
  ticket(1, [], "Lo stato in revisione in Sources/Orders"),
  ticket(2, [1], "Il supporto vede gli ordini in revisione in Sources/Support"),
  ticket(3, [1], "Il rimborso manuale passa da Sources/Payments"),
];

function plan(tickets: SliceTicket[]): WorkPlan {
  const slicing: PlanSlicing = { status: "approved", tickets, feedback: null, approvedAt: at(2).toISOString(), failure: null, publishFailure: null };
  return {
    id: "P-1",
    requestId: "r1",
    orderedBy: "coordinator",
    kind: "agreedTicket",
    moduleIds: ["Sources/Orders", "Sources/Payments", "Sources/Support", "Sources/Mail"],
    summary: "Gli ordini pagati annullati vanno in revisione",
    issueNumber: null,
    status: "ready",
    proposal: null,
    spec: {
      seams: [{ seam: "L'interfaccia di CancelPaidOrder", existing: true, tests: "Un ordine pagato annullato va in revisione" }],
      seamsAnswer: { confirmed: true, note: null, at: at(0).toISOString() },
      sections: null as never,
      affectedModuleIDs: [],
      references: [],
      requiredDecisionIDs: [],
      issue: null,
      publishFailure: null,
    },
    slicing,
    failure: null,
    decisionRequestIds: [],
    createdAt: at(1).toISOString(),
    updatedAt: at(1).toISOString(),
  };
}

/** A project with a mandate on four modules, a team whose developers each know one module and an approved breakdown. */
function project(tickets: SliceTicket[] = TICKETS.map((t) => ({ ...t }))) {
  const document = emptyDocument("p");
  document.requests.push({ id: "r1", text: "r1", moduleId: null, state: "completed", model: null, effort: null, createdAt: "", completedAt: null, failure: null, goalId: null });
  grantMandate(document, {
    objectives: ["Ordini"],
    priorities: [],
    scopeModuleIds: ["Sources/Orders", "Sources/Payments", "Sources/Support"],
    authorizedActions: ["plan", "executeInWorktree"],
    limits: [],
  });
  const members: [string, string][] = [
    ["Ada", "Sources/Orders"],
    ["Bruno", "Sources/Payments"],
    ["Carla", "Sources/Support"],
  ];
  const proposal = proposeTeam(document, {
    requestId: null,
    summary: null,
    members: members.map(([name, moduleId]) => ({ name, competence: "Swift", reason: "Ordini", moduleIds: [moduleId] })),
  });
  confirmTeam(document, proposal.id, null, null);
  const value = plan(tickets);
  document.plans.push(value);
  return { document, plan: value };
}

const input = (overrides: Partial<PickInput> = {}): PickInput => ({
  modules: MODULES,
  presence: null,
  providers: [{ id: "codex", models: ["gpt-5.6-luna"] }],
  fallback: { provider: "codex", model: "gpt-5.6-luna" },
  now: at(5),
  ...overrides,
});

const picked = (outcomes: PickOutcome[]) => outcomes.flatMap((o) => (o.kind === "picked" ? [o] : []));
const waiting = (outcomes: PickOutcome[]) => outcomes.flatMap((o) => (o.kind === "waiting" ? [`${o.sliceId}: ${o.reason}`] : []));
const name = (document: ProjectDocument, specialistId: string) => document.team.specialists.find((s) => s.id === specialistId)!.name;

/** A Pact decision the candidates respect. */
function decision(document: ProjectDocument) {
  if (document.decisions[0]) return document.decisions[0];
  const alternatives = [
    { behavior: "Solo il supporto", example: "Il supporto vede l'ordine 42", consequence: null },
    { behavior: "Anche il cliente", example: "Il cliente vede lo stato review", consequence: null },
  ];
  const question = createDecisionRequest(document, { requestId: "r1", category: "product", question: "Chi vede la revisione?", concreteCase: "Ordine 42", alternatives, revisesDecisionId: null });
  return answerDecisionRequest(document, question.id, { alternativeIndex: 0, freeText: null }).decision;
}

/** Ends the assignment with a candidate that passed its checks and the technical review: the slice is verified. */
function verify(document: ProjectDocument, assignmentId: string) {
  endTurn(document, assignmentId, null, { kind: "completed", text: "Fatto" });
  const candidate = declareCandidate(
    document,
    { assignmentId, decisionIds: [decision(document).id], unresolvedChoices: [], externalEffects: [] },
    { snapshotId: `snap-${assignmentId}`, baseSHA: "base", diff: "+x", changedFiles: ["NOTE.md"], excludedSensitiveFiles: [] },
  );
  for (const check of findAssignment(document, assignmentId)!.requiredChecks) {
    recordEvidence(document, candidate.id, { check, passed: true, command: check, output: "", snapshotId: candidate.snapshotId });
  }
  recordTechnicalReview(document, candidate.id, { reviewerThreadId: "reviewer", authorThreadId: "author", verdict: "approved", summary: "Letto" });
  return candidate;
}

describe("independent movement (W08)", () => {
  it("lets a free developer take the next ready slice in its modules, with the contract of the slice", () => {
    const { document, plan } = project();
    const outcomes = pickSlices(document, input());
    const [first] = picked(outcomes);
    expect(picked(outcomes)).toHaveLength(1);
    expect(first).toMatchObject({ planId: "P-1", sliceId: "S1" });
    expect(name(document, first!.assignment.specialistId)).toBe("Ada");
    expect(first!.assignment).toMatchObject({
      selfPicked: true,
      slice: { planId: "P-1", sliceId: "S1" },
      objective: "S1 Fetta 1",
      moduleIds: ["Sources/Orders"],
      dependencies: [],
      requiredChecks: DEFAULT_SLICE_CHECKS,
      provider: "codex",
      model: "gpt-5.6-luna",
      requestId: "r1",
      mandateVersion: document.mandate!.version,
      seams: [{ number: 1, seam: "L'interfaccia di CancelPaidOrder", tests: "Un ordine pagato annullato va in revisione" }],
    });
    expect(first!.assignment.instructions).toContain("Hai preso in autonomia la fetta S1");
    expect(first!.assignment.instructions).toContain("- Criterio 1");
    // S2 and S3 wait for S1: nobody takes them yet, and a second call takes nothing more.
    expect(sliceViews(document, plan).map((v) => v.state)).toEqual(["working", "blocked", "blocked"]);
    expect(pickSlices(document, input())).toEqual([]);
  });

  it("unblocks the dependent slices once a slice is verified, and each developer takes the one in its modules", () => {
    const { document, plan } = project();
    const [first] = picked(pickSlices(document, input()));
    // A completed slice that Trama has not verified yet unblocks nothing.
    endTurn(document, first!.assignment.id, null, { kind: "completed", text: "Fatto" });
    expect(pickSlices(document, input())).toEqual([]);
    expect(sliceViews(document, plan).map((v) => v.state)).toEqual(["verifying", "blocked", "blocked"]);
    // The verification is on a new candidate of the same work.
    first!.assignment.status = "running";
    verify(document, first!.assignment.id);
    expect(sliceViews(document, plan).map((v) => v.state)).toEqual(["done", "ready", "ready"]);
    const next = picked(pickSlices(document, input({ now: at(20) })));
    expect(next.map((p) => [p.sliceId, name(document, p.assignment.specialistId)])).toEqual([
      ["S2", "Carla"],
      ["S3", "Bruno"],
    ]);
    // The work of the verified blocker is a dependency, its Pact decision carries over, and the checks follow S1's.
    for (const pick of next) {
      expect(pick.assignment.dependencies).toEqual([first!.assignment.id]);
      expect(pick.assignment.requiredChecks).toEqual(DEFAULT_SLICE_CHECKS);
      expect(Object.keys(pick.assignment.decisionVersions ?? {})).toEqual([decision(document).id]);
    }
    expect(activeDevelopers(document)).toBe(2);
  });

  it("stays within the project's parallel limit", () => {
    const tickets = [ticket(1, [], "Sources/Orders"), ticket(2, [], "Sources/Payments"), ticket(3, [], "Sources/Support")];
    const { document } = project(tickets);
    document.settings = { parallelDevelopers: 2 };
    expect(picked(pickSlices(document, input())).map((p) => p.sliceId)).toEqual(["S1", "S2"]);
    expect(pickSlices(document, input())).toEqual([]);
    document.settings = { parallelDevelopers: 3 };
    expect(picked(pickSlices(document, input())).map((p) => p.sliceId)).toEqual(["S3"]);
  });

  it("takes a slice only within the mandate and a developer's modules", () => {
    const tickets = [ticket(1, [], "Le email partono da Sources/Mail"), ticket(2, [], "Sources/Orders")];
    const { document } = project(tickets);
    const outcomes = pickSlices(document, input());
    expect(waiting(outcomes)).toEqual(["S1: Il mandato non copre il lavoro di questa fetta."]);
    expect(picked(outcomes).map((p) => p.sliceId)).toEqual(["S2"]);
    // Inside the mandate, but no free developer knows the module.
    document.mandate!.scopeModuleIds.push("Sources/Mail");
    expect(waiting(pickSlices(document, input()))).toEqual(["S1: Nessuno sviluppatore libero copre i moduli di questa fetta."]);
    // Without a granted mandate nobody moves.
    document.mandate!.status = "revoked";
    expect(pickSlices(document, input())).toEqual([]);
  });

  it("never takes a slice paused by a blocking question (W06)", () => {
    const tickets = [ticket(1, [], "Sources/Orders"), ticket(2, [], "Sources/Payments")];
    const { document, plan } = project(tickets);
    plan.slicing!.tickets[0]!.pause = { reason: "Aspetta la risposta sul rimborso", since: at(3).toISOString() };
    expect(picked(pickSlices(document, input())).map((p) => p.sliceId)).toEqual(["S2"]);
    plan.slicing!.tickets[0]!.pause = null;
    expect(picked(pickSlices(document, input())).map((p) => p.sliceId)).toEqual(["S1"]);
  });

  it("waits while another assignment works on the same modules or a colleague touches them", () => {
    const tickets = [ticket(1, [], "Sources/Orders"), ticket(2, [], "Anche questa in Sources/Orders")];
    const { document } = project(tickets);
    document.team.specialists.find((s) => s.name === "Bruno")!.moduleIds = [];
    const outcomes = pickSlices(document, input());
    expect(picked(outcomes).map((p) => p.sliceId)).toEqual(["S1"]);
    expect(waiting(outcomes)).toEqual([expect.stringMatching(/^S2: Aspetta che finisca A-[0-9A-F]+, che lavora sugli stessi moduli\.$/)]);
    const other = project([ticket(1, [], "Sources/Orders")]).document;
    const presence = {
      others: [
        {
          self: false,
          status: "active",
          idleMinutes: 0,
          record: { user: "bea", name: "Bea", activeBranch: "feature/x", files: ["Sources/Orders/Cancel.swift"], agents: [], task: null },
        },
      ],
    } as unknown as PresenceView;
    expect(waiting(pickSlices(other, input({ presence })))).toEqual(["S1: Qualcuno tocca ora questi moduli: Bea."]);
  });

  it("uses a connected provider and waits when no provider can work", () => {
    const tickets = [ticket(1, [], "Sources/Orders"), ticket(2, [], "Sources/Payments")];
    const { document } = project(tickets);
    const none = pickSlices(document, input({ providers: [] }));
    expect(waiting(none)).toEqual(["S1: Nessun provider collegato può lavorare ora.", "S2: Nessun provider collegato può lavorare ora."]);
    const [first] = picked(pickSlices(document, input({ providers: [{ id: "claudeAgent", models: ["sonnet"] }], fallback: { provider: "claudeAgent", model: "sonnet" } })));
    expect(first!.assignment).toMatchObject({ provider: "claudeAgent", model: "sonnet" });
  });

  it("gives a slice on several modules only to a developer who covers them all", () => {
    const { document } = project([ticket(1, [], "Il rimborso tocca Sources/Orders e Sources/Payments")]);
    // Ada knows only Orders and Bruno only Payments: neither takes the slice, which keeps its whole scope.
    expect(waiting(pickSlices(document, input()))).toEqual(["S1: Nessuno sviluppatore libero copre i moduli di questa fetta."]);
    document.team.specialists.find((s) => s.name === "Carla")!.moduleIds = [];
    const [pick] = picked(pickSlices(document, input()));
    expect(name(document, pick!.assignment.specialistId)).toBe("Carla");
    expect(pick!.assignment.moduleIds).toEqual(["Sources/Orders", "Sources/Payments"]);
  });

  it("carries the Pact decisions the spec requires from the first slice", () => {
    const { document, plan } = project();
    const required = decision(document);
    plan.spec!.requiredDecisionIDs = [required.id];
    const [first] = picked(pickSlices(document, input()));
    expect(first!.assignment.decisionVersions).toEqual({ [required.id]: required.version });
  });

  it("reads the modules of a slice from its text, then from the plan", () => {
    const { plan } = project();
    expect(sliceModules(TICKETS[1]!, plan, MODULES, [])).toEqual(["Sources/Support"]);
    expect(sliceModules(ticket(4, [], "Nessun modulo nominato"), plan, MODULES, [])).toEqual(plan.moduleIds);
    expect(sliceModules(ticket(4, [], "Il modulo Payments"), plan, MODULES, [])).toEqual(["Sources/Payments"]);
  });
});
