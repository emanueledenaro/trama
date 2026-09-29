import { afterEach, describe, expect, it, vi } from "vitest";
import { activityLog } from "@shared/activity";
import type { Candidate, CoordinatorRequest, ProjectDocument, SpecialistAssignment } from "@shared/domain";
import { candidateSuperseded } from "@shared/conflictScope";
import { settledCard } from "@shared/settledCards";
import type { TimelineRow } from "@shared/timeline";
import { waitingForYou } from "@shared/waitingForYou";
import { CandidateError, candidateReport, declareCandidate, inspectCandidate, openCorrections, recordEvidence, recordTechnicalReview, sameWork, supersedeCandidate } from "./candidates";
import { runCoordinatorTool, type ToolContext } from "./coordinatorTools";
import { emptyDocument } from "./document";
import { answerDecisionRequest, createDecisionRequest, grantMandate } from "./pact";
import { assign, confirmTeam, endTurn, proposeTeam, recordWorkspace } from "./team";

/**
 * Issue #421: on the shop project Marco's candidate n. 13 was stopped by his candidates n. 3 and n. 8 of the same work,
 * verified but never merged. openCorrections does not take them as corrected, so they counted as other work on the same
 * files. The Coordinator now declares them superseded by itself, with the reason.
 */

const at = (minute: number) => new Date(Date.UTC(2026, 8, 29, 9, minute));

function request(document: ProjectDocument, id: string, minute: number): CoordinatorRequest {
  const value: CoordinatorRequest = { id, text: id, moduleId: null, state: "completed", model: "gpt-5.5", effort: null, createdAt: at(minute).toISOString(), completedAt: null, failure: null, goalId: null, step: null };
  document.requests.push(value);
  return value;
}

/** The shop project: a mandate, Marco and Bea as developers, one Pact decision and the person's first message. */
function shop(): ProjectDocument {
  const document = emptyDocument("negozio");
  grantMandate(document, { objectives: ["Negozio"], priorities: [], scopeModuleIds: ["src/app", "src/lib"], authorizedActions: ["plan", "executeInWorktree"], limits: [] });
  const proposal = proposeTeam(document, {
    requestId: null,
    summary: null,
    members: [
      { name: "Marco", competence: "Next.js", reason: "Negozio", moduleIds: ["src/app"] },
      { name: "Bea", competence: "Next.js", reason: "Prezzi", moduleIds: ["src/lib"] },
    ],
  });
  confirmTeam(document, proposal.id, null, null);
  const alternatives = [
    { behavior: "Solo i prodotti disponibili", example: "La scheda 12 non compare", consequence: null },
    { behavior: "Tutti i prodotti", example: "La scheda 12 compare esaurita", consequence: null },
  ];
  const question = createDecisionRequest(document, { requestId: null, category: "product", question: "Quali prodotti mostra il catalogo?", concreteCase: "Scheda 12", alternatives, revisesDecisionId: null });
  answerDecisionRequest(document, question.id, { alternativeIndex: 0, freeText: null });
  request(document, "r1", 0);
  return document;
}

function work(document: ProjectDocument, specialist: string, requestId: string, minute: number, moduleIds = ["src/app"], slice: SpecialistAssignment["slice"] = undefined): SpecialistAssignment {
  const assignment = assign(
    document,
    {
      specialist,
      kind: "agreedTicket",
      objective: "Catalogo con i soli prodotti disponibili",
      issueNumber: null,
      exercise: null,
      moduleIds,
      dependencies: [],
      model: "gpt-5.5",
      tools: ["edits"],
      requiredChecks: ["git_status"],
      instructions: "Consegna",
    },
    document.mandate!.version,
    requestId,
    at(minute),
  );
  if (slice) assignment.slice = slice;
  recordWorkspace(document, assignment.id, { worktreeRoot: `/tmp/${assignment.id}`, branch: `feature/${assignment.id}`, baseSHA: "base", createdAt: at(minute).toISOString() } as never, at(minute));
  return assignment;
}

/** The developer ends the work; its candidate passes its check and the technical review approves it. */
function deliver(document: ProjectDocument, assignment: SpecialistAssignment, minute: number): Candidate {
  endTurn(document, assignment.id, null, { kind: "completed", text: "Fatto" }, at(minute));
  const candidate = declareCandidate(
    document,
    { assignmentId: assignment.id, decisionIds: [document.decisions[0]!.id], unresolvedChoices: [], externalEffects: [] },
    { snapshotId: `snap-${assignment.id}`, baseSHA: "base", diff: "+x", changedFiles: ["src/app/prodotti/page.tsx"], excludedSensitiveFiles: [], whitespaceErrors: [] },
    at(minute),
  );
  recordEvidence(document, candidate.id, { check: "git_status", passed: true, command: "git status", output: "", snapshotId: candidate.snapshotId }, at(minute));
  recordTechnicalReview(document, candidate.id, { reviewerThreadId: "reviewer", authorThreadId: "author", verdict: "approved", summary: "Bene" }, at(minute));
  return candidate;
}

/** Trama's comparison of two worktrees that change the same files (W08). */
function collide(document: ProjectDocument, candidate: Candidate, other: Candidate, minute: number) {
  (document.conflicts ??= []).push({
    id: `${candidate.snapshotId}:worktree:${other.snapshotId}`,
    candidateId: candidate.id,
    snapshotId: candidate.snapshotId,
    otherCandidateId: other.id,
    otherSnapshotId: other.snapshotId,
    remoteSHA: "",
    references: [`${other.id} di Marco`],
    classification: "conflict",
    conflictingFiles: ["src/app/prodotti/page.tsx"],
    detail: "",
    checkedAt: at(minute).toISOString(),
  });
}

/** Marco's three versions of the same work, n. 3, n. 8 and n. 13; the newest collides with the two older ones. */
function threeVersions() {
  const document = shop();
  const third = deliver(document, work(document, "Marco", "r1", 1), 2);
  request(document, "r2", 3);
  const eighth = deliver(document, work(document, "Marco", "r2", 4), 5);
  request(document, "r3", 6);
  const thirteenth = deliver(document, work(document, "Marco", "r3", 7), 8);
  collide(document, thirteenth, third, 9);
  collide(document, thirteenth, eighth, 9);
  return { document, third, eighth, thirteenth };
}

const reports = (document: ProjectDocument) => Object.fromEntries(document.candidates.map((c) => [c.id, candidateReport(document, c, "base")]));

describe("the Coordinator supersedes an older candidate of the same work (issue #421)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reproduces the shop: two verified versions not merged block the newest as other work on the same files", () => {
    const { document, third, eighth, thirteenth } = threeVersions();
    // Issue #389 does not take verified work as corrected: the older versions stay open (only the stopped newest is).
    expect(openCorrections(document, "r3", { moduleIds: ["src/app"], slice: null })).toEqual([thirteenth.assignmentId]);
    expect(candidateSuperseded(document, third)).toBe(false);
    expect(candidateSuperseded(document, eighth)).toBe(false);
    expect(inspectCandidate(document, thirteenth, "base").map((b) => b.code)).toEqual(["WORKTREE_CONFLICT", "WORKTREE_CONFLICT"]);
    expect(candidateReport(document, thirteenth, "base").state).toBe("building");
  });

  it("stops a superseded candidate from blocking the newest, and its item leaves Aspetta te", () => {
    const { document, third, eighth, thirteenth } = threeVersions();
    expect(waitingForYou(document, { candidateReports: reports(document) }).map((i) => i.targetId)).toEqual(expect.arrayContaining([third.id, eighth.id]));

    const waiting = { label: "Candidato da guardare", title: "Catalogo con i soli prodotti disponibili" };
    supersedeCandidate(document, { candidateId: third.id, byCandidateId: thirteenth.id, reason: "È una versione vecchia dello stesso lavoro.", actor: "Coordinatore", waiting }, at(10));
    expect(third.supersession).toEqual({ byCandidateId: thirteenth.id, reason: "È una versione vecchia dello stesso lavoro", actor: "Coordinatore", at: at(10).toISOString(), waiting });
    expect(candidateReport(document, third, "base").state).toBe("superseded");
    expect(inspectCandidate(document, thirteenth, "base").map((b) => b.code)).toEqual(["WORKTREE_CONFLICT"]);

    supersedeCandidate(document, { candidateId: eighth.id, byCandidateId: thirteenth.id, reason: "Versione vecchia", actor: "Coordinatore", waiting: null }, at(11));
    expect(inspectCandidate(document, thirteenth, "base")).toEqual([]);
    expect(candidateReport(document, thirteenth, "base").state).toBe("verified");
    // The superseded versions ask nothing of the person any more; the newest waits in their place.
    expect(waitingForYou(document, { candidateReports: reports(document) }).map((i) => i.targetId)).toEqual([thirteenth.id]);
    // Superseded is not deleted: the candidates stay in the history.
    expect(document.candidates.map((c) => c.id)).toEqual([third.id, eighth.id, thirteenth.id]);
  });

  it("refuses a merged candidate, a candidate of other work and the newest candidate itself", () => {
    const { document, third, eighth, thirteenth } = threeVersions();
    const refusal = (candidateId: string, byCandidateId: string, reason = "Versione vecchia") => {
      try {
        supersedeCandidate(document, { candidateId, byCandidateId, reason, actor: "Coordinatore", waiting: null }, at(20));
      } catch (error) {
        expect(error).toBeInstanceOf(CandidateError);
        return (error as CandidateError).code;
      }
      throw new Error("Expected a refusal");
    };
    // The newest candidate itself, and the newest against an older one.
    expect(refusal(thirteenth.id, thirteenth.id)).toBe("candidate_is_newest");
    expect(refusal(thirteenth.id, third.id)).toBe("candidate_is_newest");
    // Other work: Bea's candidate on other modules.
    request(document, "r4", 21);
    const prices = deliver(document, work(document, "Bea", "r4", 22, ["src/lib"]), 23);
    expect(sameWork(document, third, prices)).toBe(false);
    expect(refusal(third.id, prices.id)).toBe("other_work");
    // Merged work is done, not superseded.
    eighth.pullRequest = { number: 8, url: "https://github.com/negozio/negozio/pull/8", branch: "feature/8", mergedAt: at(12).toISOString() } as never;
    expect(refusal(eighth.id, thirteenth.id)).toBe("candidate_merged");
    // No reason, no supersession.
    expect(refusal(third.id, thirteenth.id, "  ")).toBe("missing_reason");
    expect([third, eighth, thirteenth, prices].map((c) => c.supersession)).toEqual([undefined, undefined, undefined, undefined]);
    expect(candidateReport(document, thirteenth, "base").state).toBe("building");
  });

  it("takes the same slice as the same work and a different slice as other work, whatever the modules", () => {
    const document = shop();
    const slice = { planId: "P-1", sliceId: "S1" };
    const first = deliver(document, work(document, "Marco", "r1", 1, ["src/app"], slice), 2);
    const again = deliver(document, work(document, "Bea", "r1", 3, ["src/lib"], slice), 4);
    const next = deliver(document, work(document, "Marco", "r1", 5, ["src/app"], { planId: "P-1", sliceId: "S2" }), 6);
    const outside = deliver(document, work(document, "Marco", "r1", 7, ["src/app"]), 8);
    expect(sameWork(document, first, again)).toBe(true);
    expect(sameWork(document, first, next)).toBe(false);
    expect(sameWork(document, first, outside)).toBe(false);
  });

  it("supersede_candidate records the use for Activity, the chat line and the item that left Aspetta te, in both languages", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(at(30));
    const { document, third, thirteenth } = threeVersions();
    const cards: { kind: string; referenceId: string }[] = [];
    let changes = 0;
    const context = {
      document,
      runningRequestId: "r3",
      changed: () => void changes++,
      addCard: (kind: string, _title: string, referenceId: string) => void cards.push({ kind, referenceId }),
      waitingFor: (id: string) => (id === third.id ? { label: "Candidato da guardare", title: "Catalogo con i soli prodotti disponibili" } : null),
      headSHA: async () => "base",
    } as unknown as ToolContext;

    // Only candidate ids: an assignment id could stand for the newest version.
    const byAssignment = await runCoordinatorTool("supersede_candidate", { candidate: third.assignmentId, newerCandidate: thirteenth.id, reason: "Vecchia" }, context);
    expect(byAssignment.isError).toBe(true);
    expect(byAssignment.content[0]!.text).toContain("unknown_candidate");
    const itself = await runCoordinatorTool("supersede_candidate", { candidate: thirteenth.id, newerCandidate: thirteenth.id, reason: "Vecchia" }, context);
    expect(itself.content[0]!.text).toContain("candidate_is_newest");

    const result = await runCoordinatorTool("supersede_candidate", { candidate: third.id, newerCandidate: thirteenth.id, reason: "La versione n. 13 contiene lo stesso lavoro, aggiornato" }, context);
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ candidateID: third.id, newerCandidateID: thirteenth.id, state: "superseded", leftWaitingForYou: true });
    expect(cards).toEqual([{ kind: "candidate", referenceId: third.id }]);
    expect(changes).toBe(1);

    // Activity: one row of the Coordinator's step, with the reason and the item that left Aspetta te.
    const entries = activityLog([], [], [], [], [], document.candidates);
    expect(entries.filter((e) => e.kind === "supersede")).toEqual([
      expect.objectContaining({
        id: `supersede:${third.id}`,
        label: "Candidato superato dal Coordinatore",
        outcome: "done",
        startedAt: at(30).toISOString(),
        detail: `Candidato ${third.id}, superato da ${thirteenth.id}: La versione n. 13 contiene lo stesso lavoro, aggiornato. Tolto da Aspetta te: Candidato da guardare, Catalogo con i soli prodotti disponibili.`,
      }),
    ]);
    const english = activityLog([], [], [], [], [], document.candidates, [], "en").find((e) => e.kind === "supersede")!;
    expect(english.label).toBe("Candidate superseded by the Coordinator");
    expect(english.detail).toContain("Removed from Waiting for you: Candidato da guardare");

    // The chat: the candidate's card settles as one "Superato" line with the reason; it opens the card.
    const row = { kind: "card", id: "row", cardKind: "candidate", event: { id: "E-1", sequence: 1, origin: "trama", requestId: "r3", createdAt: at(30).toISOString(), content: { type: "card", kind: "candidate", title: "Candidato", detail: null, referenceId: third.id } } } as unknown as TimelineRow;
    const states = { candidateStates: Object.fromEntries(Object.entries(reports(document)).map(([id, r]) => [id, r.state])), colleagues: [] };
    expect(settledCard(document, row, states)).toMatchObject({
      title: `Candidato ${third.id}`,
      subject: "Marco: 1 file, motivo: La versione n. 13 contiene lo stesso lavoro, aggiornato",
      outcome: { label: "Superato", tone: "secondary" },
    });
    expect(settledCard(document, row, { ...states, language: "en" })).toMatchObject({
      subject: "Marco: 1 file, reason: La versione n. 13 contiene lo stesso lavoro, aggiornato",
      outcome: { label: "Superseded" },
    });
    // A second use on the same candidate changes nothing.
    const again = await runCoordinatorTool("supersede_candidate", { candidate: third.id, newerCandidate: thirteenth.id, reason: "Ancora" }, context);
    expect(again.content[0]!.text).toContain("already_superseded");
    expect(cards).toHaveLength(1);
  });
});
