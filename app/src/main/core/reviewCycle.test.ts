import { describe, expect, it } from "vitest";
import type { Candidate, CoordinatorRequest, ProjectDocument, SpecialistAssignment } from "@shared/domain";
import { candidateSuperseded } from "@shared/conflictScope";
import { GATE_ROLES } from "@shared/gate";
import { REVIEW_LOOP_LIMIT } from "@shared/reviewLoop";
import { waitingForYou } from "@shared/waitingForYou";
import { candidateReport, declareCandidate, inspectCandidate, openCorrections, recordEvidence, recordTechnicalReview } from "./candidates";
import { automaticMove } from "./continuousWork";
import { emptyDocument } from "./document";
import { beginReviews, closeGate, finishReview, openGate, pendingReturns } from "./gate";
import { answerDecisionRequest, createDecisionRequest, grantMandate } from "./pact";
import { assign, confirmTeam, endTurn, proposeTeam, recordWorkspace, reopenForFindings } from "./team";
import { workState } from "./workPhase";

/**
 * Issue #389: the cycle of candidates and reviews closes. A correction retires the version it corrects, an automatic
 * move starts only with work to do, and after too many blocks in a row the work waits for the person.
 */

const at = (minute: number) => new Date(Date.UTC(2026, 8, 28, 14, minute));
const guards = { enabled: true, paused: false, busy: false, unavailable: null };

function request(document: ProjectDocument, id: string, minute: number, step: CoordinatorRequest["step"] = null): CoordinatorRequest {
  const value: CoordinatorRequest = { id, text: id, moduleId: null, state: "completed", model: "gpt-5.5", effort: null, createdAt: at(minute).toISOString(), completedAt: null, failure: null, goalId: null, step };
  document.requests.push(value);
  return value;
}

/** A project with a mandate, a confirmed team of two developers, one Pact decision and the person's first message. */
function project(): ProjectDocument {
  const document = emptyDocument("negozio");
  grantMandate(document, { objectives: ["Negozio"], priorities: [], scopeModuleIds: ["Sources/Orders"], authorizedActions: ["plan", "executeInWorktree"], limits: [] });
  const proposal = proposeTeam(document, {
    requestId: null,
    summary: null,
    members: [
      { name: "Ada", competence: "Swift", reason: "Ordini", moduleIds: ["Sources/Orders"] },
      { name: "Bruno", competence: "Swift", reason: "Ordini", moduleIds: ["Sources/Orders"] },
    ],
  });
  confirmTeam(document, proposal.id, null, null);
  const alternatives = [
    { behavior: "Solo il supporto", example: "Il supporto vede l'ordine 42", consequence: null },
    { behavior: "Anche il cliente", example: "Il cliente vede lo stato review", consequence: null },
  ];
  const question = createDecisionRequest(document, { requestId: null, category: "product", question: "Chi vede la revisione?", concreteCase: "Ordine 42", alternatives, revisesDecisionId: null });
  answerDecisionRequest(document, question.id, { alternativeIndex: 0, freeText: null });
  request(document, "r1", 0);
  return document;
}

function work(document: ProjectDocument, specialist: string, requestId: string, minute: number, replaces: string[] = []): SpecialistAssignment {
  const assignment = assign(
    document,
    {
      specialist,
      kind: "agreedTicket",
      objective: "Ordini in revisione",
      issueNumber: null,
      exercise: null,
      moduleIds: ["Sources/Orders"],
      dependencies: [],
      model: "gpt-5.5",
      tools: ["edits"],
      requiredChecks: ["git_status"],
      instructions: "Consegna",
      replaces,
    },
    document.mandate!.version,
    requestId,
    at(minute),
  );
  recordWorkspace(document, assignment.id, { worktreeRoot: `/tmp/${assignment.id}`, branch: `feature/${assignment.id}`, baseSHA: "base", createdAt: at(minute).toISOString() } as never, at(minute));
  return assignment;
}

/** The developer ends a turn and Trama declares the worktree's content as a candidate with a passing check. */
function deliver(document: ProjectDocument, assignment: SpecialistAssignment, minute: number): Candidate {
  endTurn(document, assignment.id, null, { kind: "completed", text: "Fatto" }, at(minute));
  const candidate = declareCandidate(
    document,
    { assignmentId: assignment.id, decisionIds: [document.decisions[0]!.id], unresolvedChoices: [], externalEffects: [] },
    { snapshotId: `snap-${assignment.id}-${minute}`, baseSHA: "base", diff: "+x", changedFiles: ["Sources/Orders/Order.swift"], excludedSensitiveFiles: [], whitespaceErrors: [] },
    at(minute),
  );
  recordEvidence(document, candidate.id, { check: "git_status", passed: true, command: "git status", output: "", snapshotId: candidate.snapshotId }, at(minute));
  return candidate;
}

/** The gate stops the candidate with a new blocking finding, as the reviewers did in the audit. */
function block(document: ProjectDocument, candidate: Candidate, minute: number) {
  const gate = openGate(document, candidate, at(minute));
  beginReviews(gate, { spec: false, model: "mini", cleanCodeModel: "gpt-5.5" }, at(minute));
  for (const role of GATE_ROLES) finishReview(gate, role, { report: "", findings: [] }, at(minute));
  finishReview(gate, "performance", { report: "", findings: [{ severity: "blocking", title: `Rilievo ${minute}`, detail: "Nuovo", file: null }] }, at(minute));
  closeGate(gate, at(minute));
  recordTechnicalReview(document, candidate.id, { reviewerThreadId: `gate:${gate.id}`, authorThreadId: "author", verdict: "changesRequested", summary: "Fermato", gateId: gate.id }, at(minute));
  return gate;
}

/** Trama sends the findings back and the developer resumes and finishes in the same worktree (W10). */
function sendBackAndFinish(document: ProjectDocument, assignment: SpecialistAssignment, gate: ReturnType<typeof block>, minute: number) {
  reopenForFindings(document, assignment.id, { gateId: gate.id, candidateId: gate.candidateId, findings: ["Rilievo"] }, at(minute));
  gate.returned = { assignmentId: assignment.id, at: at(minute).toISOString(), waiting: null };
  endTurn(document, assignment.id, null, { kind: "completed", text: "Corretto" }, at(minute + 1));
}

const coordinatorMoves = (document: ProjectDocument, requestId: string) =>
  workState(document, requestId)
    .moves.filter((m) => m.actor === "coordinator")
    .map((m) => m.move);

describe("the cycle of candidates and reviews (issue #389)", () => {
  it("asks for a new candidate, not a correction, once the developer finished the work the gate sent back", () => {
    const document = project();
    const ada = work(document, "Ada", "r1", 1);
    const gate = block(document, deliver(document, ada, 2), 3);
    sendBackAndFinish(document, ada, gate, 4);

    const state = workState(document, "r1");
    // The old verdict describes a worktree that moved on: the Coordinator declares the corrected work.
    expect(state.phase).toBe("verification");
    expect(state.verification).toEqual({ undeclared: [ada.id], unverified: [] });
    expect(coordinatorMoves(document, "r1")).toEqual(["verifyCandidate"]);
    expect(automaticMove(document, "r1", "round", guards)?.move).toBe("verifyCandidate");
  });

  it("retires the blocked candidate that a correction replaces, so the two versions never collide", () => {
    const document = project();
    const ada = work(document, "Ada", "r1", 1);
    const first = deliver(document, ada, 2);
    const gate = block(document, first, 3);
    // The findings could not go back to Ada: the Coordinator assigns the correction to Bruno, on the same modules.
    gate.returned = { assignmentId: ada.id, at: at(3).toISOString(), waiting: "Lo sviluppatore lavora a un altro incarico." };
    request(document, "r2", 4, { move: "assignWork", by: "trama" });
    const corrects = openCorrections(document, "r2", { moduleIds: ["Sources/Orders"], slice: null });
    expect(corrects).toEqual([ada.id]);
    const bruno = work(document, "Bruno", "r2", 5, corrects);
    const second = deliver(document, bruno, 6);

    expect(candidateSuperseded(document, first)).toBe(true);
    expect(candidateReport(document, first, null).state).toBe("superseded");
    // A comparison of the two worktrees no longer blocks the new version.
    (document.conflicts ??= []).push({
      id: "X-1",
      candidateId: second.id,
      snapshotId: second.snapshotId,
      otherCandidateId: first.id,
      otherSnapshotId: first.snapshotId,
      remoteSHA: "",
      references: ["Ada"],
      classification: "conflict",
      conflictingFiles: ["Sources/Orders/Order.swift"],
      detail: "",
      checkedAt: at(6).toISOString(),
    });
    expect(inspectCandidate(document, second, null).map((b) => b.code)).not.toContain("WORKTREE_CONFLICT");
    // The replaced work does not resume by itself when its developer is free again.
    expect(pendingReturns(document)).toEqual([]);
  });

  it("does not take new work on the same modules for a correction when the earlier candidate is fine (U02)", () => {
    const document = project();
    const ada = work(document, "Ada", "r1", 1);
    const candidate = deliver(document, ada, 2);
    recordTechnicalReview(document, candidate.id, { reviewerThreadId: "reviewer", authorThreadId: "author", verdict: "approved", summary: "Bene" }, at(3));
    request(document, "r2", 4);
    expect(openCorrections(document, "r2", { moduleIds: ["Sources/Orders"], slice: null })).toEqual([]);
  });

  it("starts no verification while the reviewers are already at work on the only candidate", () => {
    const document = project();
    const ada = work(document, "Ada", "r1", 1);
    const candidate = deliver(document, ada, 2);
    const gate = openGate(document, candidate, at(3));
    beginReviews(gate, { spec: false, model: "mini", cleanCodeModel: "gpt-5.5" }, at(3));

    expect(workState(document, "r1").phase).toBe("verification");
    expect(coordinatorMoves(document, "r1")).toEqual([]);
    expect(automaticMove(document, "r1", "round", guards)).toBeNull();
  });

  it(`holds the work for the person after ${REVIEW_LOOP_LIMIT} blocks in a row instead of starting another round`, () => {
    const document = project();
    const ada = work(document, "Ada", "r1", 1);
    let minute = 2;
    let last: Candidate | null = null;
    for (let round = 1; round <= REVIEW_LOOP_LIMIT; round++) {
      last = deliver(document, ada, minute);
      const gate = block(document, last, minute + 1);
      if (round < REVIEW_LOOP_LIMIT) sendBackAndFinish(document, ada, gate, minute + 2);
      minute += 4;
    }

    const state = workState(document, "r1");
    expect(state.phase).toBe("blocked");
    expect(state.block).toBeUndefined();
    expect(state.blocker).toContain("Aspetta te");
    expect(coordinatorMoves(document, "r1")).toEqual([]);
    for (const event of ["round", "checkFailed", "assignmentEnded"] as const) expect(automaticMove(document, "r1", event, guards)).toBeNull();

    const reports = Object.fromEntries(document.candidates.map((c) => [c.id, candidateReport(document, c, null)]));
    const waiting = waitingForYou(document, { candidateReports: reports });
    expect(waiting.map((item) => item.key)).toEqual([`candidate:${last!.id}`]);
    expect(waiting[0]).toMatchObject({ label: "Lavoro fermato più volte", title: `Ordini in revisione: la revisione l'ha fermato ${REVIEW_LOOP_LIMIT} volte di seguito. Scrivi al Coordinatore come andare avanti.` });
    expect(waitingForYou(document, { candidateReports: reports, language: "en" })[0]).toMatchObject({ label: "Work stopped several times" });

    // Once the person writes how to go on, the Coordinator takes the work again.
    request(document, "r2", minute + 1);
    expect(waitingForYou(document, { candidateReports: reports })).toEqual([]);
    expect(workState(document, "r2").block).toBe("checkFailed");
  });

  it("keeps a return Trama held for the person out of the returns it retries", () => {
    const document = project();
    const ada = work(document, "Ada", "r1", 1);
    const gate = block(document, deliver(document, ada, 2), 3);
    gate.returned = { assignmentId: ada.id, at: at(3).toISOString(), waiting: "Fermo", held: true };
    expect(pendingReturns(document)).toEqual([]);
  });
});
