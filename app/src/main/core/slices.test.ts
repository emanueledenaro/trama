import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PlanSlicing, ProjectDocument, SliceTicket, WorkPlan } from "@shared/domain";
import type { RepositorySnapshot } from "@shared/repository";
import { declareCandidate, recordEvidence, recordTechnicalReview } from "./candidates";
import { emptyDocument, normalizeDocument } from "./document";
import { loadNativeSkill } from "./nativeSkills";
import { answerDecisionRequest, createDecisionRequest, grantMandate } from "./pact";
import {
  breakdownText,
  draftSlicing,
  readSlicerAnswer,
  SliceError,
  sliceAssignmentProblem,
  slicerTurn,
  sliceViews,
  slicesText,
  TICKET_TRIAGE_LABEL,
  ticketMarkdown,
  TO_TICKETS_BINDING,
} from "./slices";
import { assign, confirmTeam, endTurn, MAX_PARALLEL_DEVELOPERS, proposeTeam, TeamError } from "./team";
import { workState } from "./workPhase";

const skillsDirectory = join(import.meta.dirname, "../../../resources/AIHero/skills");
const toTickets = () => loadNativeSkill(skillsDirectory, "to-tickets");
const at = (minute: number) => new Date(Date.UTC(2026, 8, 26, 10, minute));

const snapshot: RepositorySnapshot = {
  name: "ordini",
  rootPath: "/tmp/ordini",
  branch: "main",
  headSHA: "abc",
  contextualInputHashes: {},
  modules: [],
  totalFileCount: 0,
  scannedAt: "2026-09-26T10:00:00.000Z",
  warnings: [],
  isDemo: false,
};

const ticket = (number: number, blockedBy: number[] = []): SliceTicket => ({
  id: `S${number}`,
  title: `Fetta ${number}`,
  whatToBuild: `Comportamento ${number}`,
  acceptanceCriteria: [`Criterio ${number}`],
  blockedBy: blockedBy.map((n) => `S${n}`),
  issue: null,
});

const slicing = (status: PlanSlicing["status"], tickets: SliceTicket[] = [ticket(1), ticket(2, [1]), ticket(3, [1])]): PlanSlicing => ({
  status,
  tickets,
  feedback: null,
  approvedAt: status === "approved" ? at(2).toISOString() : null,
  failure: status === "failed" ? "Il divisore non ha risposto." : null,
  publishFailure: null,
});

function plan(overrides: Partial<WorkPlan> = {}): WorkPlan {
  return {
    id: "P-1",
    requestId: "r1",
    orderedBy: "coordinator",
    kind: "agreedTicket",
    moduleIds: ["Sources/Orders"],
    summary: "Gli ordini pagati annullati vanno in revisione",
    issueNumber: null,
    status: "ready",
    proposal: null,
    spec: {
      seams: [{ seam: "L'interfaccia di CancelPaidOrder", existing: true, tests: "Un ordine pagato annullato va in revisione" }],
      seamsAnswer: { confirmed: true, note: null, at: at(0).toISOString() },
      sections: {
        title: "Ordini pagati annullati in revisione",
        problemStatement: "Un ordine pagato annullato viene rimborsato subito.",
        solution: "L'ordine va in revisione.",
        userStories: ["Come supporto, voglio vedere gli ordini in revisione, così che possa decidere il rimborso"],
        implementationDecisions: ["Lo stato review si aggiunge agli stati"],
        testingDecisions: ["Si prova attraverso CancelPaidOrder"],
        outOfScope: "Le email.",
        furtherNotes: "",
      },
      affectedModuleIDs: ["Sources/Orders"],
      references: [],
      requiredDecisionIDs: [],
      issue: { number: 7, url: "https://github.com/o/r/issues/7", at: at(1).toISOString() },
      publishFailure: null,
    },
    failure: null,
    decisionRequestIds: [],
    createdAt: at(1).toISOString(),
    updatedAt: at(1).toISOString(),
    ...overrides,
  };
}

/** A project with a mandate, a confirmed team of four developers and an approved breakdown on request r1. */
function project(status: PlanSlicing["status"] = "approved", tickets?: SliceTicket[]) {
  const document = emptyDocument("p");
  document.requests.push({ id: "r1", text: "r1", moduleId: null, state: "completed", model: null, effort: null, createdAt: "", completedAt: null, failure: null, goalId: null });
  grantMandate(document, { objectives: ["Ordini"], priorities: [], scopeModuleIds: ["Sources/Orders", "Sources/Payments", "Sources/Support", "Sources/Mail"], authorizedActions: ["plan", "executeInWorktree"], limits: [] });
  const proposal = proposeTeam(document, {
    requestId: null,
    summary: null,
    members: ["Ada", "Bruno", "Carla", "Dario"].map((name) => ({ name, competence: "Swift", reason: "Ordini", moduleIds: ["Sources/Orders"] })),
  });
  confirmTeam(document, proposal.id, null, null);
  const value = plan({ slicing: slicing(status, tickets) });
  document.plans.push(value);
  return { document, plan: value };
}

function work(document: ProjectDocument, specialist: string, sliceId: string | null, minute: number, module = "Sources/Orders") {
  return assign(
    document,
    {
      specialist,
      kind: "agreedTicket",
      objective: `Fetta ${sliceId}`,
      issueNumber: null,
      exercise: null,
      moduleIds: [module],
      dependencies: [],
      model: "gpt-5.5",
      tools: ["edits"],
      requiredChecks: ["git_status"],
      instructions: "Scrivi",
      slice: sliceId ? { planId: "P-1", sliceId } : null,
    },
    document.mandate!.version,
    "r1",
    at(minute),
  );
}

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

/** Ends the assignment with a candidate that passed its check and the technical review. */
function verified(document: ProjectDocument, assignmentId: string) {
  endTurn(document, assignmentId, null, { kind: "completed", text: "Fatto" });
  const candidate = declareCandidate(
    document,
    { assignmentId, decisionIds: [decision(document).id], unresolvedChoices: [], externalEffects: [] },
    { snapshotId: `snap-${assignmentId}`, baseSHA: "base", diff: "+x", changedFiles: ["NOTE.md"], excludedSensitiveFiles: [] },
  );
  recordEvidence(document, candidate.id, { check: "git_status", passed: true, command: "git status", output: "", snapshotId: candidate.snapshotId });
  recordTechnicalReview(document, candidate.id, { reviewerThreadId: "reviewer", authorThreadId: "author", verdict: "approved", summary: "Letto" });
  return candidate;
}

describe("the slicer runs to-tickets with its original text (M05)", () => {
  it("delivers to-tickets byte for byte, followed by Trama's binding", async () => {
    const skill = await toTickets();
    const turn = slicerTurn(skill, false, { plan: plan(), snapshot });
    expect(turn.skills).toEqual([]);
    const original = await readFile(join(skillsDirectory, "to-tickets/SKILL.md"));
    expect(Buffer.from(turn.developerInstructions, "utf8").includes(original)).toBe(true);
    expect(turn.developerInstructions).toContain(`## Trama binding for the to-tickets skill\n${TO_TICKETS_BINDING}`);
    // to-tickets has no reference file: the agents/ folder is Codex metadata, not method.
    expect(skill.files.map((f) => f.relativePath)).toEqual(["SKILL.md"]);
  });

  it("sends SKILL.md to Codex as a native skill input and the spec as data after the binding", async () => {
    const turn = slicerTurn(await toTickets(), true, { plan: plan(), snapshot });
    expect(turn.skills).toEqual([{ name: "to-tickets", path: join(skillsDirectory, "to-tickets/SKILL.md"), enabled: true, description: null }]);
    const original = await readFile(join(skillsDirectory, "to-tickets/SKILL.md"), "utf8");
    expect(turn.prompt).not.toContain(original);
    expect(turn.prompt).toContain(TO_TICKETS_BINDING);
    expect(turn.prompt).toContain("Fase: prima proposta.");
    expect(turn.prompt).toContain("La spec è la issue #7");
    expect(turn.prompt).toContain("## Problem Statement\n\nUn ordine pagato annullato viene rimborsato subito.");
    expect(turn.prompt).toContain("1. L'interfaccia di CancelPaidOrder (esistente).");
    expect(turn.outputSchema.required).toEqual(["sourceSnapshotID", "tickets"]);
    expect(turn.prompt.trimEnd().split("\n").at(-1)).toBe('Fonti: {"sourceSnapshotID":"abc"}');
  });

  it("gives a new round the previous breakdown and the person's correction", async () => {
    const corrected = plan({ slicing: { ...slicing("drafting"), feedback: "Dividi la terza fetta" } });
    const turn = slicerTurn(await toTickets(), true, { plan: corrected, snapshot });
    expect(turn.prompt).toContain("Fase: nuovo giro.");
    expect(turn.prompt).toContain(`## Suddivisione proposta nel giro precedente\n${breakdownText(corrected.slicing!.tickets)}`);
    expect(turn.prompt).toContain("## Risposta della persona\nDividi la terza fetta");
    expect(breakdownText(corrected.slicing!.tickets)).toContain("2. Fetta 2\n   Bloccata da: 1\n   Cosa consegna: Comportamento 2\n   - [ ] Criterio 2");
  });

  it("binds to-tickets to Trama without restating its method", async () => {
    const original = await readFile(join(skillsDirectory, "to-tickets/SKILL.md"), "utf8");
    for (const sentence of original.split(/(?<=\.)\s+/).filter((s) => s.length > 40)) {
      expect(TO_TICKETS_BINDING).not.toContain(sentence.trim());
    }
    for (const word of ["Quiz the user", "blockedBy", TICKET_TRIAGE_LABEL, "/setup-trama", "read-only", "Work the frontier", "three developers"]) {
      expect(TO_TICKETS_BINDING).toContain(word);
    }
    expect(TO_TICKETS_BINDING).not.toMatch(/tracer bullet|expand.contract|vertical, NOT/i);
  });

  it("refuses a turn without a written spec", async () => {
    expect(() => slicerTurn({ name: "to-tickets", skillPath: "", files: [] }, true, { plan: plan({ spec: null }), snapshot })).toThrow(SliceError);
  });
});

describe("reading the breakdown", () => {
  const answer = (tickets: unknown[], sourceSnapshotID = "abc") => JSON.stringify({ sourceSnapshotID, tickets });
  const raw = { title: " Stato in revisione ", whatToBuild: "L'ordine va in revisione", acceptanceCriteria: ["Ordine 42 in revisione", " "], blockedBy: [] };

  it("numbers the tickets in dependency order with their blocking edges", () => {
    const tickets = readSlicerAnswer(answer([raw, { ...raw, blockedBy: [1, 1] }, { ...raw, blockedBy: [2, 1] }]), "abc");
    expect(tickets.map((t) => [t.id, t.blockedBy])).toEqual([
      ["S1", []],
      ["S2", ["S1"]],
      ["S3", ["S1", "S2"]],
    ]);
    expect(tickets[0]).toEqual({ id: "S1", title: "Stato in revisione", whatToBuild: "L'ordine va in revisione", acceptanceCriteria: ["Ordine 42 in revisione"], blockedBy: [], issue: null });
  });

  it("refuses edges to itself or to a later ticket, so the breakdown has no cycle", () => {
    expect(() => readSlicerAnswer(answer([{ ...raw, blockedBy: [1] }]), "abc")).toThrow(/fette elencate prima/);
    expect(() => readSlicerAnswer(answer([{ ...raw, blockedBy: [2] }, raw]), "abc")).toThrow(/fette elencate prima/);
    expect(() => readSlicerAnswer(answer([raw, { ...raw, blockedBy: [0] }]), "abc")).toThrow(SliceError);
  });

  it("refuses an empty breakdown, a ticket without criteria, another snapshot and invalid JSON", () => {
    expect(() => readSlicerAnswer(answer([]), "abc")).toThrow(/non ha proposto fette/);
    expect(() => readSlicerAnswer(answer([{ ...raw, acceptanceCriteria: [] }]), "abc")).toThrow(/criteri di accettazione/);
    expect(() => readSlicerAnswer(answer([{ ...raw, title: "" }]), "abc")).toThrow(/titolo/);
    expect(() => readSlicerAnswer(answer([raw], "old"), "abc")).toThrow(/altra istantanea/);
    expect(() => readSlicerAnswer("{", "abc")).toThrow(/JSON valido/);
  });

  it("keeps the previous tickets only for a new round with the person's correction", () => {
    const previous = slicing("proposed");
    expect(draftSlicing(previous, "Unisci le ultime due")).toMatchObject({ status: "drafting", tickets: previous.tickets, feedback: "Unisci le ultime due" });
    expect(draftSlicing(previous, null)).toMatchObject({ status: "drafting", tickets: [], feedback: null });
  });
});

describe("publishing a ticket with to-tickets' issue template", () => {
  it("has the template's sections, the parent spec and real issue numbers for the blocking edges", async () => {
    const original = await readFile(join(skillsDirectory, "to-tickets/SKILL.md"), "utf8");
    const template = original.slice(original.indexOf("<issue-template>"), original.indexOf("</issue-template>"));
    const headings = (text: string) => text.split("\n").filter((line) => line.startsWith("## "));
    const tickets = [{ ...ticket(1), issue: { number: 8, url: "u", at: "" } }, ticket(2, [1])];
    const markdown = ticketMarkdown(tickets[1]!, tickets, 7);
    expect(headings(markdown)).toEqual(headings(template));
    expect(markdown).toBe("## Parent\n\n#7\n\n## What to build\n\nComportamento 2\n\n## Acceptance criteria\n\n- [ ] Criterio 2\n\n## Blocked by\n\n- #8");
    // Without a parent issue the section is left out, and a ticket without blockers says it can start.
    const first = ticketMarkdown(tickets[0]!, tickets, null);
    expect(headings(first)).toEqual(headings(template).slice(1));
    expect(first).toContain("## Blocked by\n\n- Nessuna: si può iniziare subito.");
  });
});

describe("assigning only unblocked slices (M05)", () => {
  it("computes the frontier: a verified slice unblocks the slices that depend on it", () => {
    const { document, plan } = project();
    expect(sliceViews(document, plan).map((v) => [v.id, v.state, v.waitingFor])).toEqual([
      ["S1", "ready", []],
      ["S2", "blocked", ["S1"]],
      ["S3", "blocked", ["S1"]],
    ]);
    const first = work(document, "Ada", "S1", 3);
    expect(sliceViews(document, plan).map((v) => v.state)).toEqual(["working", "blocked", "blocked"]);
    endTurn(document, first.id, null, { kind: "completed", text: "Fatto" });
    // Finished work is not done until Trama verified it: the next slices stay blocked.
    expect(sliceViews(document, plan).map((v) => v.state)).toEqual(["verifying", "blocked", "blocked"]);
    verified(document, first.id);
    expect(sliceViews(document, plan).map((v) => v.state)).toEqual(["done", "ready", "ready"]);
    expect(sliceViews(document, { ...plan, slicing: slicing("proposed") })).toEqual([]);
  });

  it("refuses a blocked slice, a slice at work and a done one", () => {
    const { document, plan } = project();
    expect(sliceAssignmentProblem(document, plan, "S2")).toBe("Slice S2 is blocked by S1: assign it when they are done.");
    expect(sliceAssignmentProblem(document, plan, "S9")).toMatch(/Unknown slice S9/);
    expect(sliceAssignmentProblem(document, plan, "S1")).toBeNull();
    const first = work(document, "Ada", "S1", 3);
    expect(sliceAssignmentProblem(document, plan, "S1")).toBe(`Slice S1 is already assigned: ${first.id} is working on it.`);
    verified(document, first.id);
    expect(sliceAssignmentProblem(document, plan, "S1")).toBe("Slice S1 is already done.");
    expect(sliceAssignmentProblem(document, plan, "S2")).toBeNull();
    expect(sliceAssignmentProblem(document, { ...plan, slicing: slicing("proposed") }, "S1")).toMatch(/not approved/);
  });

  it(`runs at most ${MAX_PARALLEL_DEVELOPERS} developers in parallel`, () => {
    const tickets = [ticket(1), ticket(2), ticket(3), ticket(4)];
    const { document, plan } = project("approved", tickets);
    work(document, "Ada", "S1", 3, "Sources/Orders");
    work(document, "Bruno", "S2", 4, "Sources/Payments");
    work(document, "Carla", "S3", 5, "Sources/Support");
    expect(() => work(document, "Dario", "S4", 6, "Sources/Mail")).toThrow(TeamError);
    expect(() => work(document, "Dario", "S4", 6, "Sources/Mail")).toThrow(/3 developers are already at work/);
    // The slice is still ready, but no developer is free: Trama does not offer to assign.
    expect(sliceViews(document, plan).at(-1)!.state).toBe("ready");
    expect(workState(document, "r1").moves.map((m) => m.move)).not.toContain("assignWork");
  });

  it("tells the Coordinator the slices, what the ready ones deliver and the limit", () => {
    const { document, plan } = project();
    plan.slicing!.tickets[0]!.issue = { number: 8, url: "u", at: "" };
    const text = slicesText(plan, sliceViews(document, plan), 0);
    expect(text).toContain("- S1 «Fetta 1»: issue #8, pronta.\n  Cosa consegna: Comportamento 1\n  - [ ] Criterio 1");
    expect(text).toContain("- S2 «Fetta 2»: bloccata da S1.");
    expect(text).toContain("Sviluppatori al lavoro: 0 di 3.");
    expect(text).not.toContain("Comportamento 2");
  });
});

describe("the phase of sliced work (M05)", () => {
  it("is slices while the breakdown is drawn, then waits for the person to confirm it", () => {
    const { document, plan } = project("drafting");
    expect(workState(document, "r1")).toEqual({ phase: "slices", blocker: null, moves: [] });
    plan.slicing!.status = "proposed";
    expect(workState(document, "r1")).toEqual({
      phase: "slices",
      blocker: null,
      moves: [{ move: "confirmSlices", actor: "person", label: "Conferma le fette", targetId: plan.id, url: null, message: null }],
    });
  });

  it("is blocked when the breakdown failed, with the plan card to try again", () => {
    const { document, plan } = project("failed");
    expect(workState(document, "r1")).toMatchObject({
      phase: "blocked",
      blocker: `La divisione in fette del piano ${plan.id} non è riuscita: Il divisore non ha risposto.`,
      moves: [{ move: "reviewPlan", actor: "person" }],
    });
  });

  it("assigns the unblocked slices beside the running work, and is merged only when every slice is done", () => {
    const { document, plan } = project();
    expect(workState(document, "r1")).toMatchObject({ phase: "slices", moves: [{ move: "assignWork" }] });
    const first = work(document, "Ada", "S1", 3);
    // S2 and S3 wait for S1: nothing else to assign while it runs.
    expect(workState(document, "r1")).toMatchObject({ phase: "execution", moves: [] });
    const candidate = verified(document, first.id);
    candidate.pullRequest = { url: "https://github.com/o/r/pull/9", number: 9, branch: "trama/a", at: at(8).toISOString(), mergedAt: at(9).toISOString() };
    expect(workState(document, "r1")).toMatchObject({ phase: "execution", moves: [{ move: "assignWork" }] });
    const second = work(document, "Bruno", "S2", 10);
    // The slice on the same modules builds on S1's work, it does not replace it.
    expect(workState(document, "r1")).toMatchObject({ phase: "execution", moves: [{ move: "assignWork" }] });
    const third = work(document, "Carla", "S3", 11, "Sources/Payments");
    expect(workState(document, "r1").moves).toEqual([]);
    for (const assignment of [second, third]) {
      const done = verified(document, assignment.id);
      done.pullRequest = { url: "https://github.com/o/r/pull/10", number: 10, branch: "trama/b", at: at(12).toISOString(), mergedAt: at(13).toISOString() };
    }
    expect(workState(document, "r1")).toMatchObject({ phase: "merged", moves: [] });
    expect(workState(document, "r1").slices?.views.map((v) => v.state)).toEqual(["done", "done", "done"]);
  });

  it("marks a breakdown interrupted by a restart as failed", () => {
    const { document, plan } = project("drafting");
    const reopened = normalizeDocument(JSON.parse(JSON.stringify(document)), "p");
    expect(reopened.plans.find((p) => p.id === plan.id)!.slicing).toMatchObject({ status: "failed", failure: expect.stringMatching(/interrotta/) });
  });
});
